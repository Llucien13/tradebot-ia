"""V86 observer: copies existing state only. Never calls market/start/observe/save."""
import threading
import time
import uuid
from copy import deepcopy

from monitor_metrics import INITIAL, metrics, trade_id
from monitor_store import MonitorStore
from monitor_telegram import credentials, deliver_one


class PaperMonitor:
    def __init__(self, trial):
        self.trial = trial
        self.store = MonitorStore(trial.file.with_name("monitor-v86.sqlite3"))
        self.stop = threading.Event()
        self.lock = threading.RLock()
        self.cached = None
        self.error = None
        self.thread = threading.Thread(target=self.loop, name="paper-monitor-v86", daemon=True)
        self.sender = threading.Thread(target=self.send_loop, name="paper-telegram-v86", daemon=True)

    def start(self):
        self.thread.start()
        self.sender.start()

    def sample(self):
        now = time.time()
        # Keep only the copy inside the engine lock; no disk/network/metrics work there.
        with self.trial.lock:
            snapshot = self.trial.snapshot()
            counts = deepcopy(getattr(self.trial, "frame_counts", {}))
        status = self.store.ingest(snapshot, now)
        state = snapshot["state"]
        quote = snapshot.get("feed") or state.get("lastQuote")
        worker = snapshot["worker"]
        hb = worker.get("heartbeat")
        valued_quote = state.get("lastQuote")
        fresh = bool(snapshot["valuationFresh"] and worker["alive"] and hb is not None
                     and status == "RUNNING"
                     and 0 <= now-hb <= 15 and quote and valued_quote
                     and all(0 <= now-quote[k] <= 15 and valued_quote.get(k) == quote[k]
                             for k in ("time", "fxTime")))
        position = state.get("position")
        floating = state["equity"]-state["balance"] if position and fresh else 0. if not position else None
        position_data = None
        if position:
            risk = position.get("riskEUR", 0)
            commission = position.get("entryCommissionEUR")
            net = floating-commission if floating is not None and commission is not None else None
            position_data = {**position, "id": trade_id(position), "instrument": "XAUUSD",
                             "floatingEUR": floating, "netPositionEUR": net,
                             "percentInitial": net/INITIAL*100 if net is not None else None,
                             "r": net/risk if net is not None and risk > 0 else None,
                             "riskPercentInitial": risk/INITIAL*100,
                             "needsReview": bool(state.get("monitoringBlocked") or not state.get("verifiedContinuous"))}
        ages = {}
        for symbol, key in (("XAUUSD", "time"), ("EURUSD", "fxTime")):
            stamp = quote.get(key) if quote else None
            ages[symbol] = {"time": stamp, "age": now-stamp if stamp is not None else None,
                            "fresh": stamp is not None and 0 <= now-stamp <= 15}
        result = {"version": 86, "mode": "PAPER", "liveEnabled": False, "readOnly": True,
                  "observedAt": now, "fresh": fresh, "status": status,
                  "position": position_data, "quote": quote, "floatingEUR": floating,
                  "metrics": metrics(state, now), "costModel": snapshot["costModel"],
                  "antiGap": deepcopy(state.get("antiGap")),
                  "health": {"mt5": "CONNECTED" if snapshot["connected"] else "DISCONNECTED" if state.get("error", "").startswith("MT5 non connecte au serveur du broker.") else "UNKNOWN",
                             "worker": worker, "ticks": ages, "frameCounts": counts,
                             "m15": "INSUFFICIENT" if "Historique MT5 insuffisant : M15" in state.get("error", "") else "LAST_VALIDATED" if counts.get("m15", 0) >= 201 else "UNKNOWN",
                             "lastObserved": state.get("lastObserved"),
                             "lastSignal": state.get("lastSignalResult"),
                             "waitingReason": state.get("quoteWaitReason"), "waitingAge": state.get("quoteWaitAge"),
                             "error": state.get("error"), "storageFault": snapshot.get("storageFault"),
                             "continuous": state.get("verifiedContinuous", False)}}
        with self.lock:
            self.cached, self.error = result, None

    def loop(self):
        while not self.stop.is_set():
            try:
                self.sample()
            except Exception:
                with self.lock:
                    self.error = "Observateur V86 indisponible : lecture ou index local en erreur. Moteur V85 inchange."
            self.stop.wait(3)

    def send_loop(self):
        while not self.stop.wait(3):
            try:
                deliver_one(self.store)
            except Exception:
                # Sender failure is isolated, visible, and cannot escape to the PAPER worker.
                with self.lock:
                    self.error = "Service de notifications en erreur; moteur PAPER inchange."

    def snapshot(self):
        with self.lock:
            result = deepcopy(self.cached)
            error = self.error
        if result is None:
            return {"ready": False, "observerError": error or "Premiere observation en cours"}
        with self.store.lock:
            last_error = self.store.get("lastError")
            notification = {"configured": bool(credentials()), "settings": self.store.settings(),
                            "deliveries": [dict(r) for r in self.store.db.execute("SELECT status,COUNT(*) AS count FROM outbox GROUP BY status")],
                            "lastFailure": self.store.db.execute("SELECT error FROM outbox WHERE error IS NOT NULL ORDER BY next DESC LIMIT 1").fetchone()}
            notification["lastFailure"] = notification["lastFailure"][0] if notification["lastFailure"] else None
        return {"ready": True, **result, "observerError": error, "lastError": last_error,
                "notifications": notification, "events": self.store.events()}

    def test_notification(self):
        now = time.time()
        with self.store.lock, self.store.db:
            if not credentials() or not self.store.settings()["enabled"]:
                raise ValueError("Activer Telegram et configurer les variables d'environnement avant le test")
            if now-self.store.get("lastTest", 0) < 60:
                raise ValueError("Attendre 60 secondes entre deux tests")
            self.store.event("test:"+uuid.uuid4().hex, now, now, "test",
                             "Test Monitoring PRO V86. Aucun trade ni ordre MT5 declenche.", notify=True)
            self.store.put("lastTest", now)
        return {"queued": True}

    def close(self):
        self.stop.set()
        self.thread.join(timeout=10)
        self.sender.join(timeout=10)
        if not self.thread.is_alive() and not self.sender.is_alive():
            self.store.close()
