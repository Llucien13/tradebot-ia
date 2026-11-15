"""V86 auxiliary index/events/outbox. Never writes the V85 PAPER ledger."""
import json
import sqlite3
import threading
import uuid
from monitor_metrics import trade_id

DEFAULT_SETTINGS = {"enabled": False, "open": True, "close": True, "safe": True, "recovery": False}


class MonitorStore:
    def __init__(self, path):
        self.lock = threading.RLock()
        self.db = sqlite3.connect(str(path), check_same_thread=False, timeout=5)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS trades (id TEXT PRIMARY KEY, entry REAL NOT NULL, exit REAL,
                pnl REAL, payload TEXT NOT NULL, seen REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, at REAL NOT NULL, observed REAL NOT NULL,
                kind TEXT NOT NULL, trade_id TEXT, message TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY REFERENCES events(id), status TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0, next REAL NOT NULL, error TEXT);
            CREATE INDEX IF NOT EXISTS events_at ON events(at);
            CREATE INDEX IF NOT EXISTS trades_entry ON trades(entry);
            PRAGMA user_version=1;
        """)
        # An interrupted HTTP send has an unknowable delivery outcome: never auto-duplicate it.
        with self.db:
            self.db.execute("UPDATE outbox SET status='UNCERTAIN',error='Envoi interrompu : reception inconnue' WHERE status='SENDING'")

    def get(self, key, default=None):
        row = self.db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def put(self, key, value):
        self.db.execute("INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                        (key, json.dumps(value, ensure_ascii=False)))

    def settings(self):
        return {**DEFAULT_SETTINGS, **self.get("settings", {})}

    def configure(self, values):
        if set(values) != set(DEFAULT_SETTINGS) or any(type(v) is not bool for v in values.values()):
            raise ValueError("Options de notification invalides")
        with self.lock, self.db:
            self.put("settings", values)
            if not values["enabled"]:
                self.db.execute("UPDATE outbox SET status='CANCELLED' WHERE status='PENDING'")
        return values

    def event(self, identity, at, now, kind, message, tid=None, notify=False):
        inserted = self.db.execute("INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?)",
                                   (identity, at, now, kind, tid, message)).rowcount
        if inserted and notify:
            self.db.execute("INSERT OR IGNORE INTO outbox(id,status,next) VALUES (?,'PENDING',?)", (identity, now))

    def ingest(self, snapshot, now):
        state = snapshot["state"]
        if state.get("mode") != "PAPER" or state.get("liveEnabled") is not False or not state.get("trial"):
            raise ValueError("Source non PAPER refusee")
        with self.lock, self.db:
            baseline = not self.get("initialized", False)
            settings = self.settings()
            notify = lambda kind: not baseline and settings["enabled"] and settings.get(kind, False)
            # Protection alerts survive observer/bridge restarts; the engine supplies durable IDs.
            for event in state.get("gapEvents", []):
                self.event(event["id"], event["time"], now, "safe", event["message"],
                           notify=settings["enabled"] and settings["safe"])
            current = list(state["trades"]) + ([state["position"]] if state.get("position") else [])
            for trade in current:
                tid = trade_id(trade)
                payload = json.dumps(trade, ensure_ascii=False, sort_keys=True)
                previous = self.db.execute("SELECT payload FROM trades WHERE id=?", (tid,)).fetchone()
                self.db.execute("INSERT INTO trades VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET exit=excluded.exit,pnl=excluded.pnl,payload=excluded.payload,seen=excluded.seen",
                                (tid, trade["entryTime"], trade.get("exitTime"), trade.get("pnl"), payload, now))
                message = f"XAUUSD {'ACHAT' if trade['side'] == 1 else 'VENTE'} · {tid} · entree {trade['entry']:g} · {trade['lots']:g} lots · SL {trade['sl']:g} · TP {trade['tp']:g} · risque {trade['riskEUR']:.2f} EUR"
                self.event(tid+":open", trade["entryTime"], now, "open", message, tid,
                           notify("open") and "exitTime" not in trade)
                if "exitTime" in trade:
                    closing = f"{message} · cloture confirmee {trade['exit']:g} · {trade['reason']} · resultat {trade['pnl']:+.2f} EUR"
                    self.event(tid+":close", trade["exitTime"], now, "close", closing, tid, notify("close"))
                elif previous and previous[0] != payload:
                    self.event(tid+":update:"+str(now), now, now, "update", "Mise a jour enregistree · "+message, tid)
            worker = snapshot["worker"]
            status = "SAFE_STOP" if snapshot.get("storageFault") or state.get("monitoringBlocked") or worker["status"] == "SAFE_STOP" else "WAITING_QUOTES" if state.get("quoteWaiting") else "WAITING_MARKET" if worker.get("status") == "WAITING_MARKET" else "RUNNING" if state["running"] else "STOPPED"
            reason = state.get("error") or worker.get("cause") or ""
            # Tick age changes are deliberately excluded from the waiting signature.
            signature = [status, "" if status == "WAITING_QUOTES" else reason]
            previous = self.get("health")
            if signature != previous:
                kind = "safe" if status == "SAFE_STOP" else "recovery" if status == "RUNNING" and previous and previous[0] in ("WAITING_QUOTES", "WAITING_MARKET") else "health"
                prolonged = now-self.get("waitingSince", now) >= 60
                self.event("health:"+uuid.uuid4().hex, now, now, kind, status+(" · "+reason if reason else ""),
                           notify=notify(kind) and (kind != "recovery" or prolonged))
                if status in ("WAITING_QUOTES", "WAITING_MARKET"):
                    self.put("waitingSince", now)
                self.put("health", signature)
            if reason:
                old_error = self.get("lastError")
                if not old_error or (status != "WAITING_QUOTES" and old_error["message"] != reason):
                    self.put("lastError", {"time": now, "message": reason})
            self.put("initialized", True)
            self.put("lastIngest", now)
            self.put("positionId", trade_id(state["position"]) if state.get("position") else None)
            # Only technical events are bounded; trade lifecycle events stay persistent.
            self.db.execute("DELETE FROM events WHERE trade_id IS NULL AND id NOT IN (SELECT id FROM outbox) AND id NOT IN (SELECT id FROM events WHERE trade_id IS NULL ORDER BY at DESC LIMIT 200)")
        return status

    def journal(self, start, end, result, offset, limit):
        clause = "entry<=? AND COALESCE(exit,entry)>=?"
        params = [end, start]
        if result in ("win", "loss", "neutral", "open"):
            clause += {"win": " AND pnl>0", "loss": " AND pnl<0", "neutral": " AND pnl=0", "open": " AND exit IS NULL"}[result]
        with self.lock:
            count = self.db.execute("SELECT COUNT(*) FROM trades WHERE "+clause, params).fetchone()[0]
            rows = self.db.execute("SELECT * FROM trades WHERE "+clause+" ORDER BY entry DESC,id LIMIT ? OFFSET ?", params+[limit, offset]).fetchall()
            position_id = self.get("positionId")
            return {"total": count, "offset": offset, "items": [{"id": r["id"], "trade": json.loads(r["payload"]),
                    "needsReview": r["exit"] is None and r["id"] != position_id} for r in rows]}

    def events(self, limit=60):
        with self.lock:
            return [dict(r) for r in self.db.execute("SELECT e.*,o.status AS delivery FROM events e LEFT JOIN outbox o ON o.id=e.id ORDER BY e.observed DESC,e.id DESC LIMIT ?", (limit,))]

    def close(self):
        with self.lock:
            self.db.close()
