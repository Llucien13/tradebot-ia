"""Virtual FTMO service. The MT5 object is used only for market/account metadata reads."""
import json
import math
import os
import subprocess
import sys
import threading
import time
import logging
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from paper_storage import PaperStorage

import pandas as pd
from fastapi import HTTPException
from time_basis import load_time_basis
from preparation_evidence_v76 import fee_evidence
from historical_evidence import inspect_evidence

FTMO_ROOT = Path(__file__).resolve().parents[1] / "ftmo"
FTMO_SYMBOL = "XAUUSD"
sys.path.insert(0, str(FTMO_ROOT))
from core import new_state, limits, mark, reset_day, finish_phase, volume, day_at
from frozen import frozen_signal
from verify import extract_reference, implementation_hash


class FTMOService:
    def __init__(self, mt5, connect, market_lock):
        self.mt5, self.connect, self.market_lock = mt5, connect, market_lock
        self.lock = threading.RLock()
        self.directory = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "TradeBotIA" / "ftmo20k"
        self.directory.mkdir(parents=True, exist_ok=True)
        self.file = self.directory / "challenge.json"
        self.report_file = self.directory / "verification.json"
        extract_reference()
        self.code_hash = implementation_hash()
        self.storage = PaperStorage(self.file)
        self.storage_fault = None
        self.worker = {"status": "STOPPED", "heartbeat": None, "cause": None}
        try:
            self.state = self.storage.load(new_state)
            if self.state["position"] is not None and (self.state.get("lastQuote") or {}).get("symbol") != FTMO_SYMBOL:
                raise ValueError("Position virtuelle d'un ancien flux : reprise refusee.")
            self.state["running"] = False
            # Restart never silently resumes monitoring a position with uncertain continuity.
            self.state["monitoringBlocked"] = self.state["position"] is not None
            if self.state["position"] is not None:
                self.state["verifiedContinuous"] = False
                self.state["error"] = "Reprise : position PAPER conservee, valorisation figee ; validation UTC et reprise explicite requises."
            self.durable = deepcopy(self.state)
            self.feed = None
            self.bar_info = {}
            self.connected = False
            self.verifying = False
            self.stop_event = threading.Event()
            self.save()
        except Exception:
            logging.exception("FTMO SAFE_STOP : lecture/initialisation du registre impossible")
            self.storage.close()
            raise
        self.thread = threading.Thread(target=self.loop, daemon=True)

    def halt(self, error, storage=False):
        message = str(getattr(error, "detail", error))
        self.state["running"] = False
        self.state["monitoringBlocked"] = True
        self.state["verifiedContinuous"] = False
        self.state["error"] = message
        self.connected = False
        self.feed = None
        self.worker.update(status="SAFE_STOP", cause=message)
        if storage:
            self.storage_fault = message
        logging.error("FTMO SAFE_STOP : %s ; position conservee, aucune cloture supposee", message)

    def save(self):
        if self.storage_fault:
            raise RuntimeError("Stockage verrouille apres panne : " + self.storage_fault)
        try:
            self.storage.commit(self.state)
        except Exception as error:
            # The checkpoint (including lastSignal, position and cash events) is one unit.
            # If rename durability is uncertain, no further mutation is allowed this session.
            self.state = deepcopy(self.durable)
            self.halt(error, storage=True)
            raise
        self.durable = deepcopy(self.state)

    def report(self):
        if self.verifying:
            return {"status": "RUNNING"}
        try:
            try:
                report = json.loads(self.report_file.read_text(encoding="utf-8"))
            except FileNotFoundError:
                return {"status": "NOT_RUN", "kind": "HISTORICAL_ENGINE_PROOF",
                        "requiredEvidence": "Rapport original des controles moteur/replays deja effectues avec empreintes et preuves. Pas une attestation de sauvegarde. Aucun backtest ne sera relance automatiquement."}
            if not isinstance(report, dict):
                raise ValueError("Rapport de verification invalide.")
            if report.get("status") == "PASSED" and report.get("implementationHash") != self.code_hash:
                report["status"] = "STALE"
            return report
        except (OSError, ValueError) as error:
            self.halt("Lecture du rapport impossible : " + str(error), storage=True)
            return {"status": "ERROR", "error": self.state["error"]}

    def snapshot(self):
        with self.lock:
            verification = self.report()
            with self.market_lock:
                terminal = self.mt5.terminal_info()
            connected = self.connected and terminal is not None and bool(terminal.connected)
            worker = {**self.worker, "alive": self.thread.is_alive()}
            return {"state": json.loads(json.dumps(self.state)), "limits": limits(self.state),
                    "connected": connected, "feed": {**self.feed, "bars": self.bar_info} if self.feed else None, "verification": verification, "verifying": self.verifying,
                    "historicalVerification": verification,
                    "paperPreparation": {"status": "NOT_AUTHORIZED", "historicalProofRequired": True,
                                         "costs": self.feed.get("fees") if self.feed else None,
                                         "reason": "Les preuves historiques et les controles courants sont distincts; aucun GET n'autorise START."},
                    "worker": worker, "storageFault": self.storage_fault,
                    "positionSafety": "HELD_UNPRICED" if self.state.get("monitoringBlocked") and self.state["position"] else "LAST_VERIFIED_OBSERVATION",
                    "storage": str(self.file)}

    def market(self):
        with self.market_lock:
            terminal, account = self.connect()
            mt = self.mt5
            if account.trade_mode != mt.ACCOUNT_TRADE_MODE_DEMO or not str(account.server).casefold().startswith("ftmo-demo"):
                raise ValueError("Le flux FTMO exige le compte DEMO du serveur FTMO-Demo. Aucun autre compte n'est substitue.")
            basis = load_time_basis(mt, terminal, account)
            if not mt.symbol_select(FTMO_SYMBOL, True):
                raise ValueError(FTMO_SYMBOL + " absent du terminal FTMO. Aucun repli vers XAUUSD-ECN.")
            info = mt.symbol_info(FTMO_SYMBOL); tick = mt.symbol_info_tick(FTMO_SYMBOL)
            if info is None or tick is None or not all(math.isfinite(v) for v in [tick.bid, tick.ask]) or tick.bid <= 0 or tick.ask < tick.bid:
                raise ValueError("BID/ASK MT5 indisponible.")
            tick_time = basis.tick(tick, FTMO_SYMBOL)
            if info.currency_profit != "USD" or info.expiration_time or any(not math.isfinite(v) or v <= 0 for v in [info.trade_contract_size, info.volume_min, info.volume_step, info.volume_max]):
                raise ValueError("Contrat non lineaire USD incompatible avec le moteur historique GOLD.")
            candidates = [s.name for s in (mt.symbols_get() or []) if s.currency_base == "EUR" and s.currency_profit == "USD" and not s.expiration_time]
            fx_name = "EURUSD" if "EURUSD" in candidates else "EURUSD-ECN" if "EURUSD-ECN" in candidates else candidates[0] if len(candidates) == 1 else None
            if not fx_name or not mt.symbol_select(fx_name, True):
                raise ValueError("Symbole EUR/USD introuvable ou ambigu. Aucun taux de remplacement.")
            fx = mt.symbol_info_tick(fx_name)
            if fx is None or not all(math.isfinite(v) for v in [fx.bid, fx.ask]) or fx.bid <= 0 or fx.ask < fx.bid:
                raise ValueError(f"Cotation EUR/USD valide manquante ({fx_name}). Affichez ce symbole dans l'Observation du marche. Conversion bloquee ; aucun taux de remplacement.")
            fx_time = basis.tick(fx, fx_name)
            fees = fee_evidence(mt, account, basis, time.time(), fx_name)
            if fees["status"] != "VERIFIED":
                raise ValueError("Couts FTMO non verifies : " + "; ".join(fees["blockers"]))
            positions = mt.positions_get()
            if positions is None:
                raise ValueError("Positions MT5 non verifiables; aucun ordre envoye.")
            if positions:
                raise ValueError("Positions broker ouvertes : demarrage/suivi PAPER bloque sans les modifier.")
            self.server_clock = basis.server_clock
            return {"source": "MT5", "symbol": FTMO_SYMBOL, "time": tick_time, "fees": fees, "brokerPositions": 0,
                    "timeBasis": {"encoding": basis.encoding, "zone": basis.zone_name,
                                  "server": str(account.server), "login": str(account.login)},
                    "utcValidUntil": basis.valid_until,
                    "bid": float(tick.bid), "ask": float(tick.ask), "spread": float(tick.ask-tick.bid),
                    "fxSymbol": fx_name, "fx": float((fx.bid + fx.ask) / 2), "fxTime": fx_time,
                    "accountType": {mt.ACCOUNT_TRADE_MODE_DEMO: "DEMO", mt.ACCOUNT_TRADE_MODE_REAL: "REAL", mt.ACCOUNT_TRADE_MODE_CONTEST: "CONTEST"}.get(account.trade_mode, "UNKNOWN"),
                    "company": str(account.company), "server": str(account.server),
                    "contract": {"size": float(info.trade_contract_size), "minLot": float(info.volume_min),
                                 "step": float(info.volume_step), "maxLot": float(info.volume_max),
                                 "tickSize": float(info.trade_tick_size), "tickValue": float(info.trade_tick_value),
                                 "swapMode": int(info.swap_mode), "swapLong": float(info.swap_long), "swapShort": float(info.swap_short),
                                 "tripleDay": int(info.swap_rollover3days)}}

    def test_connection(self):
        try:
            feed = self.market()
            frames = self.frames()
            native = frames["m15"].index[-1].value / 1000000000
            expected = int(feed["time"] // 900)*900
            if abs(native - expected) > 1:
                actual_time = datetime.fromtimestamp(native, timezone.utc).isoformat()
                expected_time = datetime.fromtimestamp(expected, timezone.utc).isoformat()
                raise ValueError(f"Historique XAUUSD M15 non synchronise : derniere ouverture {actual_time}, attendue {expected_time} selon le tick MT5. Ouvrez le graphique M15 et retestez apres synchronisation. Aucun decalage horaire artificiel applique.")
            with self.lock:
                self.bar_info = {name: len(frame) for name, frame in frames.items()}
                self.feed = feed; self.connected = True
            return self.snapshot()
        except Exception as error:
            with self.lock:
                self.connected = False
                self.feed = None
                self.bar_info = {}
            raise HTTPException(status_code=503, detail=str(getattr(error, "detail", error)))

    def start(self, config):
        with self.lock:
            if self.storage_fault:
                raise HTTPException(503, "SAFE_STOP stockage : diagnostic et redemarrage requis.")
            if self.state["running"]:
                raise HTTPException(409, "Le bot PAPER est deja demarre.")
            if self.state.get("mode") != "PAPER" or self.state.get("liveEnabled") is not False or self.state.get("tpR") != 2.5:
                raise HTTPException(409, "PAPER GOLD M15 2,5R, LIVE OFF exclusivement.")
            heartbeat = self.worker.get("heartbeat")
            if self.worker.get("status") != "STOPPED" or not self.thread.is_alive() or isinstance(heartbeat, bool) or not isinstance(heartbeat, (int, float)) or not math.isfinite(heartbeat) or not 0 <= time.time() - heartbeat <= 15:
                raise HTTPException(409, "Worker/heartbeat absent, non arrete, futur ou expire.")
            if self.state["status"] in {"FAILED", "SUCCEEDED"}:
                raise HTTPException(409, "Challenge termine. Archivez-le via Nouveau challenge.")
            if self.report().get("status") != "PASSED":
                raise HTTPException(409, "Preuve historique du moteur absente/invalide ou obsolete. Une sauvegarde VERIFIED ne la remplace pas. Restaurer et faire examiner le rapport historique original; aucun replay automatique autorise.")
            evidence = inspect_evidence(FTMO_ROOT, self.report_file)
            if evidence["verificationEvidence"] != "CORROBORATED_LEGACY_REPORT":
                raise HTTPException(409, "Preuves historiques insuffisantes : " + "; ".join(evidence["errors"] + evidence["verificationErrors"]))
            feed = self.market()
            frames = self.frames()
            if abs(frames["m15"].index[-1].value / 1_000_000_000 - int(feed["time"] // 900) * 900) > 1:
                raise HTTPException(409, "Historique M15 non synchronise au tick courant; START bloque.")
            config = dict(config)
            for key in ("swapLongUSD", "swapShortUSD", "swapHourUTC"):
                supplied = config.get(key)
                derived = feed["fees"][key]
                if supplied is not None and (not isinstance(supplied, (int, float)) or not math.isfinite(supplied) or abs(supplied - derived) > 1e-6):
                    raise HTTPException(409, "Cout fourni different des specifications MT5 : " + key)
                config[key] = derived
            daily_base = self.state["balance"] if self.state["position"] is None and self.state["day"] != day_at(feed["time"]) else self.state["dayBase"]
            if min(self.state["equity"] - (daily_base - 1000), self.state["equity"] - 18000) <= 0:
                raise HTTPException(409, "Marge FTMO quotidienne/totale non positive.")
            if self.state["position"] is not None:
                # Costs of an open virtual position cannot be changed mid-trade.
                for key in ["swapLongUSD", "swapShortUSD", "swapHourUTC", "commissionUSD", "slippageUSD"]:
                    if config[key] != self.state[key]:
                        raise HTTPException(409, "Couts figes pendant une position ouverte.")
            if self.state["position"] and self.state["position"].get("timeBasis") != feed["timeBasis"]:
                raise HTTPException(409, "Convention de la position non demontree ou differente : conservation sans reprise automatique.")
            self.state.update(config)
            self.state["monitoringBlocked"] = False
            self.state["running"] = True; self.state["error"] = ""
            if self.state["startedAt"] is None:
                self.state["startedAt"] = time.time()
            # Never execute a missed signal retroactively on START.
            self.state["lastSignal"] = int(time.time() // 900) * 900
            self.feed = feed; self.connected = True
            self.save()
            return self.snapshot()

    def pause(self):
        with self.lock:
            self.state["running"] = False; self.save()
            return self.snapshot()

    def reset(self):
        with self.lock:
            if self.storage_fault:
                raise HTTPException(503, "SAFE_STOP stockage : archivage/reset interdit.")
            if self.state["position"] is not None or self.state["running"]:
                raise HTTPException(409, "Pause requise et aucune position ouverte pour archiver.")
            archive = self.directory / ("challenge-" + str(time.time_ns()) + ".json")
            try:
                archive_store = PaperStorage(archive)
                try:
                    archive_store.commit(self.state)
                finally:
                    archive_store.close()
            except Exception as error:
                self.halt(error, storage=True)
                raise
            self.state = new_state(); self.save()
            return self.snapshot()

    def references(self):
        root = FTMO_ROOT / "reference" / "resultats"
        return {"results": [json.loads(p.read_text(encoding="utf-8")) for p in sorted(root.glob("ftmo_20k_*.json"))],
                "report": (FTMO_ROOT / "reference" / "RAPPORT_20K_EUR.md").read_text(encoding="utf-8")}

    def verify(self):
        with self.lock:
            if self.verifying or self.state["running"] or self.state["position"]:
                raise HTTPException(409, "Verification deja en cours, ou challenge actif. Mettez en pause sans position ouverte.")
            self.verifying = True
        def work():
            try:
                result = subprocess.run([sys.executable, str(FTMO_ROOT / "verify.py"), str(self.report_file)],
                                        cwd=str(FTMO_ROOT), capture_output=True, text=True, timeout=600, shell=False)
                if result.returncode:
                    self.report_file.write_text(json.dumps({"status": "ERROR", "error": result.stderr[-3000:]}), encoding="utf-8")
            except Exception as error:
                self.report_file.write_text(json.dumps({"status": "ERROR", "error": str(error)}), encoding="utf-8")
            finally:
                with self.lock:
                    self.verifying = False
        threading.Thread(target=work, daemon=True).start()
        return {"started": True}

    def frames(self):
        result = {}
        with self.market_lock:
            terminal, account = self.connect()
            basis = load_time_basis(self.mt5, terminal, account)
            for name, tf, count in [("m15", self.mt5.TIMEFRAME_M15, 4000), ("m30", self.mt5.TIMEFRAME_M30, 500),
                                     ("h1", self.mt5.TIMEFRAME_H1, 500), ("h4", self.mt5.TIMEFRAME_H4, 500),
                                     ("d1", self.mt5.TIMEFRAME_D1, 400), ("m5", self.mt5.TIMEFRAME_M5, 500)]:
                rates = self.mt5.copy_rates_from_pos(FTMO_SYMBOL, tf, 0, count)
                minimum = 201 if name == "m15" else 8
                if rates is None or len(rates) < minimum:
                    received = 0 if rates is None else len(rates)
                    detail = " Erreur MT5 : " + str(self.mt5.last_error()) if rates is None else ""
                    raise ValueError(f"Historique MT5 insuffisant : {FTMO_SYMBOL} {name.upper()}, {received} bougies recues, minimum {minimum} (demande {count}).{detail} Ouvrez ce graphique dans MT5 et attendez sa synchronisation, puis retestez.")
                df = pd.DataFrame(rates)
                df.index = pd.to_datetime(basis.bars(df["time"]), unit="s")
                result[name] = df[["open", "high", "low", "close"]].astype("float32")
        return result

    def close_position(self, price, reason, feed):
        s = self.state; p = s["position"]
        gross_usd = (price - p["entry"]) * p["side"] * p["contract"] * p["lots"]
        exit_cost = s["commissionUSD"] * p["lots"]
        net_exit = (gross_usd - exit_cost) / feed["fx"]
        s["balance"] += net_exit
        s["cashEvents"].append({"phase": p["phase"], "time": feed["time"], "amount": net_exit, "type": "EXIT_NET"})
        trade = {**p, "exit": price, "exitTime": feed["time"], "reason": reason,
                 "pnl": net_exit - p["entryCommissionEUR"] + p["swapsEUR"], "grossUSD": gross_usd,
                 "exitFX": feed["fx"], "balance": s["balance"]}
        s["trades"].append(trade); s["position"] = None
        if reason != "TIME":
            # Native replay skips the remainder of the M15 exit bar after SL/TP.
            s["lastSignal"] = int(feed["time"] // 900)*900
        mark(s, s["balance"], feed["time"])
        if s["status"] != "FAILED":
            finish_phase(s, feed["time"])

    def observe(self, feed):
        s = self.state; now = feed["time"]
        reset_day(s, now)
        p = s["position"]
        if p:
            rollovers = list(self.server_clock.rollovers(p["lastSwap"], now))
            for cutoff, trading_weekday in rollovers:
                if trading_weekday < 5:
                    multiplier = 3 if (trading_weekday + 1) % 7 == feed["contract"]["tripleDay"] else 1
                    cost = s["swapLongUSD" if p["side"] == 1 else "swapShortUSD"] * p["lots"] * multiplier / feed["fx"]
                    s["balance"] += cost; p["swapsEUR"] += cost
                    s["cashEvents"].append({"phase": p["phase"], "time": cutoff, "amount": cost, "type": "SWAP"})
                p["lastSwap"] = cutoff
            executable = (feed["bid"] if p["side"] == 1 else feed["ask"]) - p["side"]*s["slippageUSD"]
            floating = ((executable-p["entry"])*p["side"]*p["contract"]*p["lots"]-s["commissionUSD"]*p["lots"])/feed["fx"]
            failed = mark(s, s["balance"]+floating, now)
            reason = "FTMO_LIMIT" if failed else None
            if not reason and ((p["side"] == 1 and feed["bid"] <= p["sl"]) or (p["side"] == -1 and feed["bid"] >= p["sl"])):
                reason = "SL"
            if not reason and ((p["side"] == 1 and feed["bid"] >= p["tp"]) or (p["side"] == -1 and feed["bid"] <= p["tp"])):
                reason = "TP"
            # Timeout counts native M15 candles, not clock-time through weekends.
            with self.market_lock:
                terminal, account = self.connect()
                basis = load_time_basis(self.mt5, terminal, account)
                bars = self.mt5.copy_rates_from_pos(FTMO_SYMBOL, self.mt5.TIMEFRAME_M15, 1, 100)
                times = basis.bars([bar["time"] for bar in bars]) if bars is not None else []
            closed = sum(stamp >= p["signalTime"] for stamp in times)
            if not reason and closed >= 32:
                reason = "TIME"
            if reason:
                self.close_position(executable, reason, feed)
        else:
            mark(s, s["balance"], now)
        s["lastObserved"] = now; s["lastQuote"] = feed
        if s["running"] and s["status"] not in {"FAILED", "SUCCEEDED"} and s["position"] is None:
            bucket = int(now // 900)*900
            if bucket != s["lastSignal"]:
                s["lastSignal"] = bucket
                if now-bucket <= 10:
                    frames = self.frames()
                    side, distance, timestamp = frozen_signal(frames)
                    native = timestamp.value / 1000000000
                    if abs(native-bucket) > 1 or side == 0:
                        return
                    c = feed["contract"]
                    swap_reserve = max(0.0, -s["swapLongUSD" if side == 1 else "swapShortUSD"])*3
                    lots, risk = volume(s["equity"], feed["bid"], distance, feed["fx"], c["size"], c["minLot"], c["step"], c["maxLot"], feed["spread"], s["slippageUSD"], s["commissionUSD"], swap_reserve)
                    if lots:
                        entry = (feed["ask"] if side == 1 else feed["bid"])+side*s["slippageUSD"]
                        commission = lots*s["commissionUSD"]/feed["fx"]
                        s["balance"] -= commission
                        s["cashEvents"].append({"phase": s["phase"], "time": now, "amount": -commission, "type": "ENTRY_COMMISSION"})
                        swap_cutoff = self.server_clock.last_midnight(now)
                        s["position"] = {"phase": s["phase"], "entryTime": now, "signalTime": bucket, "entry": entry,
                                         "timeBasis": feed["timeBasis"], "swapSpecification": feed["fees"]["raw"],
                                         "referenceBid": feed["bid"], "side": side, "lots": lots, "contract": c["size"],
                                         "sl": feed["bid"]-side*distance, "tp": feed["bid"]+side*distance*s["tpR"],
                                         "riskEUR": risk, "entryFX": feed["fx"], "entryCommissionEUR": commission,
                                         "swapsEUR": 0.0, "lastSwap": swap_cutoff}
                        day = day_at(now)
                        if day not in s["days"]:
                            s["days"].append(day)
                        # Entry spread and commissions count immediately against limits.
                        p = s["position"]
                        liquidation = (feed["bid"] if side == 1 else feed["ask"])-side*s["slippageUSD"]
                        equity = s["balance"]+((liquidation-entry)*side*c["size"]*lots-lots*s["commissionUSD"])/feed["fx"]
                        if mark(s, equity, now):
                            self.close_position(liquidation, "FTMO_LIMIT", feed)
        s["lastObserved"] = now; s["lastQuote"] = feed
        if not s["curve"] or now-s["curve"][-1]["time"] >= 60:
            s["curve"].append({"time": now, "equity": s["equity"], "balance": s["balance"], "phase": s["phase"]})

    def cycle(self):
        with self.lock:
            self.worker["heartbeat"] = time.time()
            if self.storage_fault or self.state.get("monitoringBlocked"):
                self.worker["status"] = "SAFE_STOP"
                return
            if not self.state["running"] and self.state["position"] is None:
                self.worker["status"] = "STOPPED"
                return
            before = deepcopy(self.state)
            try:
                feed = self.market()
                if self.state["position"] and self.state["position"].get("timeBasis") != feed["timeBasis"]:
                    raise ValueError("Convention temporelle de la position non verifiee.")
                if self.state["position"] and self.state["position"].get("swapSpecification") != feed["fees"]["raw"]:
                    raise ValueError("Specification swap MT5 absente/modifiee pendant une position : suivi bloque sans cout invente.")
                for key in ("swapLongUSD", "swapShortUSD"):
                    self.state[key] = feed["fees"][key]
                self.state["swapHourUTC"] = feed["fees"]["swapHourUTC"]
                self.feed = feed; self.connected = True
                previous = self.state["lastObserved"]
                if previous and feed["time"]-previous > 15:
                    self.state["verifiedContinuous"] = False
                    self.state["interruptions"].append({"from": previous, "to": feed["time"], "reason": "Interruption du suivi ; excursions intrabar inconnues."})
                self.observe(feed)
                self.save()
                self.worker.update(status="MONITORING", cause=None)
            except Exception as error:
                if not self.storage_fault:
                    # No partially applied swap/exit survives an invalid observation.
                    self.state = before
                    self.halt(error)
                    self.state["interruptions"].append({"from": self.state["lastObserved"], "to": time.time(), "reason": self.state["error"]})
                    try:
                        self.save()
                    except Exception:
                        logging.exception("FTMO : echec du checkpoint d'arret securise")

    def loop(self):
        try:
            while not self.stop_event.wait(2):
                self.cycle()
        except Exception as error:
            with self.lock:
                self.halt(error)
            logging.exception("FTMO : worker interrompu")
