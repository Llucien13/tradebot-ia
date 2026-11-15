"""Standalone virtual trial using the existing GOLD signals, sizing and storage.
No challenge report, broker orders, historical replay or phase progression.
"""
import json
import math
import os
import threading
import time
from copy import deepcopy
from pathlib import Path
import logging
import uuid

import pandas as pd
from fastapi import HTTPException

from ftmo_service import FTMOService, FTMO_SYMBOL, new_state, volume, frozen_signal, mark, reset_day
from paper_storage import PaperStorage
from paper_time import StaleQuoteError, configured_paper_basis
from quote_time import tick_timestamp
from weekly_gap import market_protection
from mt5_availability import IPC_GATE, MarketPause, MT5IPCError, confirmed_pause


class PaperTrial(FTMOService):
    def __init__(self, mt5, connect, market_lock, challenge):
        self.mt5, self.connect, self.market_lock = mt5, connect, market_lock
        self.challenge = challenge
        self.lock = threading.RLock()
        directory = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "TradeBotIA" / "essai-paper20k"
        self.file = directory / "essai.json"
        self.storage = PaperStorage(self.file)
        self.storage_fault = None
        self.worker = {"status": "STOPPED", "heartbeat": None, "cause": None}
        try:
            self.state = self.storage.load(new_state)
            if self.state.get("tpR") != 2.5:
                raise ValueError("Registre essai incompatible avec GOLD M15 2,5R.")
            self.state.update(running=False, trial=True, monitoringBlocked=self.state["position"] is not None,
                              quoteWaiting=False, quoteWaitReason=None, quoteWaitAge=None)
            self.state.update(swapLongUSD=0., swapShortUSD=0., swapHourUTC=0)
            if self.state["position"]:
                self.state["error"] = "Position virtuelle conservee apres redemarrage. Reprendre explicitement l'essai avec des donnees fiables."
                self.state["verifiedContinuous"] = False
            self.durable = deepcopy(self.state)
            self.feed = None
            self.connected = False
            self.verifying = False
            self.stop_event = threading.Event()
            self.save()
        except Exception:
            self.storage.close()
            raise
        self.thread = threading.Thread(target=self.loop, daemon=True)
        self.bases = {}

    def halt(self, error, storage=False):
        super().halt(error, storage=storage)
        self.state.update(quoteWaiting=False, quoteWaitReason=None, quoteWaitAge=None)
        self.ipc_retry = (0, time.monotonic()+15) if isinstance(error, MT5IPCError) and not storage else None

    def refresh_gap(self, feed=None, problem=None, record=True):
        quote = feed or getattr(self, "feed", None) or self.state.get("lastQuote") or {}
        identity = quote.get("timeBasis") or (self.state.get("position") or {}).get("timeBasis")
        now = time.time()
        policy = market_protection(now, identity)
        previous = self.state.get("antiGap", {})
        position = self.state.get("position")
        if not position and previous.get("status") == "CLOSED" and previous.get("weeklyClose") == policy["weeklyClose"] and not policy["entriesAllowed"]:
            policy.update(status="CLOSED", reason=previous["reason"])
        if (position and previous.get("status") == "CLOSE_PENDING"
                and previous.get("weeklyClose") == policy["weeklyClose"] and policy["marketOpen"] is True):
            policy.update(status="CLOSE_PENDING", closeDue=True)
            if not problem:
                policy["reason"] = previous["reason"]
        if problem and position:
            if policy["closeDue"] or policy["marketOpen"] is False:
                policy["status"] = "CLOSE_PENDING"
            policy["reason"] += " Position PAPER conservee sans sortie inventee : " + str(problem)
        self.state["antiGap"] = policy
        if record and (self.state["running"] or self.state.get("position")):
            position = self.state.get("position") or {}
            key = [policy["status"], policy["weeklyClose"], policy["evidenceSha256"], position.get("entryTime")]
            if key != self.state.get("gapEventKey"):
                self.state["gapEventKey"] = key
                if policy["status"] != "OPEN":
                    event = {"id": "gap:"+uuid.uuid4().hex, "time": now, "status": policy["status"],
                             "message": "ANTI-GAP PAPER : "+policy["reason"]}
                    self.state["gapEvents"] = (self.state.get("gapEvents", [])+[event])[-32:]
        return policy

    def snapshot(self):
        with self.lock:
            now = time.time()
            fresh = self.connected and self.feed is not None and 0 <= now - self.feed["time"] <= 15 and 0 <= now - self.feed["fxTime"] <= 15
            return {"kind": "ESSAI_PAPER", "state": json.loads(json.dumps(self.state)),
                    "connected": fresh, "feed": self.feed if fresh else None,
                    "quoteWaiting": self.state.get("quoteWaiting", False),
                    "worker": {**self.worker, "alive": self.thread.is_alive()},
                    "storageFault": self.storage_fault,
                    "valuationFresh": fresh and not self.state.get("monitoringBlocked", False),
                    "costModel": f"Spread MT5 + commission de simulation {self.state['commissionUSD']:g} USD/lot/cote + slippage {self.state['slippageUSD']:g} USD. Swaps exclus de cet essai, pas un resultat net FTMO.",
                    "riskPercent": .5, "storage": str(self.file)}

    def market(self):
        with self.market_lock:
            terminal, account = self.connect()
            mt = self.mt5
            if account.trade_mode != mt.ACCOUNT_TRADE_MODE_DEMO:
                raise ValueError("Compte MT5 DEMO requis pour l'essai; aucun ordre n'est envoye.")
            for symbol in (FTMO_SYMBOL, "EURUSD"):
                if not mt.symbol_select(symbol, True):
                    IPC_GATE.failure(mt.last_error())
                    raise ValueError("Symbole MT5 indisponible : " + symbol)
            paused = confirmed_pause(terminal, account, time.time())
            if paused:
                raise MarketPause(paused)
            gold, fx = mt.symbol_info_tick(FTMO_SYMBOL), mt.symbol_info_tick("EURUSD")
            info, fx_info = mt.symbol_info(FTMO_SYMBOL), mt.symbol_info("EURUSD")
            if gold is None or fx is None or info is None or fx_info is None:
                IPC_GATE.failure(mt.last_error())
                raise ValueError("Cours ou specifications XAUUSD/EURUSD absents.")
            for tick in (gold, fx):
                if any(not math.isfinite(v) for v in (tick.bid, tick.ask)) or tick.bid <= 0 or tick.ask < tick.bid:
                    raise ValueError("BID/ASK absent ou incoherent; nouvelles positions refusees.")
            now = time.time()
            configured_basis = configured_paper_basis(mt, account, now)
            stamps, bases, errors = {}, {}, []
            stale = None
            for symbol, tick in ((FTMO_SYMBOL, gold), ("EURUSD", fx)):
                try:
                    raw = tick_timestamp(tick)
                    symbol_basis = configured_basis.basis_for_tick(raw, now, symbol)
                    bases[symbol] = symbol_basis
                    stamps[symbol] = symbol_basis.tick(tick, symbol, now)
                except StaleQuoteError as error:
                    if stale is None:
                        stale = error
                except (ValueError, TypeError, AttributeError) as error:
                    errors.append(f"{symbol} : {error} [MT5 time={getattr(tick, 'time', None)}, time_msc={getattr(tick, 'time_msc', None)}, UTC passerelle={now:.3f}]")
            if errors:
                raise ValueError("ESSAI PAPER refuse : " + " ; ".join(errors))
            if not (info.currency_base == "XAU" or (info.currency_base == "USD" and info.currency_profit == "USD" and info.trade_calc_mode == 4 and info.trade_contract_size == 100)) or info.currency_profit != "USD" or info.expiration_time or fx_info.currency_base != "EUR" or fx_info.currency_profit != "USD" or info.trade_calc_mode not in (0, 2, 4, 5):
                raise ValueError("Contrats lineaires XAUUSD USD / EURUSD incompatibles.")
            if any(not math.isfinite(v) or v <= 0 for v in (info.trade_contract_size, info.volume_min, info.volume_step, info.volume_max)):
                raise ValueError("Taille de contrat ou volumes invalides.")
            if stale is not None:
                raise stale
            gold_time, fx_time = stamps[FTMO_SYMBOL], stamps["EURUSD"]
            for symbol in (FTMO_SYMBOL, "EURUSD"):
                current = mt.copy_rates_from_pos(symbol, mt.TIMEFRAME_M15, 0, 1)
                if current is None:
                    IPC_GATE.failure(mt.last_error())
                if current is None or len(current) != 1 or abs(bases[symbol].bars([float(current[0]["time"])], now)[0] - int(stamps[symbol] // 900) * 900) > 1:
                    raise ValueError(f"Tick et bougie M15 MT5 {symbol} non synchronises.")
            self.bases = bases
            self.basis = bases[FTMO_SYMBOL]
            return {"time": gold_time, "fxTime": fx_time, "bid": float(gold.bid), "ask": float(gold.ask),
                    "spread": float(gold.ask - gold.bid), "fx": float((fx.bid + fx.ask) / 2),
                    "timeBasis": {"encoding": "PER_SYMBOL",
                                  "symbolEncodings": {symbol: {"encoding": item.encoding, "zone": item.zone_name}
                                                      for symbol, item in bases.items()},
                                  "server": str(account.server), "login": str(account.login)},
                    "contract": {"size": float(info.trade_contract_size), "minLot": float(info.volume_min),
                                 "step": float(info.volume_step), "maxLot": float(info.volume_max)}}

    def frames(self):
        frames = {}
        with self.market_lock:
            for name, tf, count in (("m15", self.mt5.TIMEFRAME_M15, 4000), ("m30", self.mt5.TIMEFRAME_M30, 500),
                                    ("h1", self.mt5.TIMEFRAME_H1, 500), ("h4", self.mt5.TIMEFRAME_H4, 500),
                                    ("d1", self.mt5.TIMEFRAME_D1, 400)):
                rates = self.mt5.copy_rates_from_pos(FTMO_SYMBOL, tf, 0, count)
                if rates is None:
                    IPC_GATE.failure(self.mt5.last_error())
                if rates is None or len(rates) < (201 if name == "m15" else 20):
                    raise ValueError("Historique MT5 insuffisant : " + name.upper())
                df = pd.DataFrame(rates)
                times = self.bases[FTMO_SYMBOL].bars(df["time"].tolist())
                ohlc = df[["open", "high", "low", "close"]]
                if not all(math.isfinite(float(v)) and float(v) > 0 for row in ohlc.itertuples(index=False, name=None) for v in row):
                    raise ValueError("Bougies MT5 non finies ou non positives : " + name)
                if ((df.high < df.low) | (df.high < df.open) | (df.high < df.close) | (df.low > df.open) | (df.low > df.close)).any():
                    raise ValueError("OHLC MT5 incoherents : " + name)
                max_age = {"m15": 900, "m30": 1800, "h1": 3600, "h4": 14400, "d1": 86400}[name]
                if not 0 <= self.feed_time - times[-1] < max_age:
                    raise ValueError("Derniere bougie " + name.upper() + " absente, future ou non synchronisee.")
                df.index = pd.to_datetime(times, unit="s")
                frames[name] = df[["open", "high", "low", "close"]].astype("float32")
            if abs(frames["m15"].index[-1].value / 1e9 - int(self.feed_time // 900) * 900) > 1:
                raise ValueError("Historique M15 courant non synchronise.")
            self.frame_counts = {name: len(df) for name, df in frames.items()}
        return frames

    def start(self):
        # Same lock order as the worker; never starts or mutates the challenge.
        with self.lock:
            if self.storage_fault:
                raise HTTPException(503, "Registre essai en erreur : " + self.storage_fault)
            if self.state["status"] == "FAILED":
                raise HTTPException(409, "Limite de perte de l'essai atteinte; aucun reset automatique du capital.")
            if self.state["running"]:
                return self.snapshot()
            if not self.thread.is_alive():
                raise HTTPException(503, "Worker de l'essai indisponible; relancer la passerelle.")
            if any(not isinstance(self.state[key], (int, float)) or not math.isfinite(self.state[key]) or self.state[key] < 0 for key in ("commissionUSD", "slippageUSD")):
                raise HTTPException(409, "Couts de simulation du registre invalides.")
            if self.challenge is not None:
                with self.challenge.lock:
                    if self.challenge.state["running"] or self.challenge.state["position"] is not None or self.challenge.verifying:
                        raise HTTPException(409, "Challenge actif ou en verification : essai refuse pour ne pas executer deux moteurs.")
            try:
                feed = self.market()
                self.feed_time = feed["time"]
                self.frames()
                if self.state["position"] and self.state["position"].get("timeBasis") != feed["timeBasis"]:
                    raise ValueError("Compte ou convention differente de la position conservee.")
                self.state.update(running=True, monitoringBlocked=False, quoteWaiting=False, quoteWaitReason=None,
                                  quoteWaitAge=None, error="", lastObserved=feed["time"],
                                  lastSignal=int(feed["time"] // 900) * 900)
                if self.state["startedAt"] is None:
                    self.state["startedAt"] = time.time()
                self.feed, self.connected = feed, True
                self.refresh_gap(feed)
                self.worker.update(status="MONITORING", cause=None, heartbeat=time.time())
                self.save()
            except StaleQuoteError as error:
                if not self.storage_fault:
                    self.state.update(running=True, monitoringBlocked=False, quoteWaiting=True, error=str(error),
                                      quoteWaitReason=str(error), quoteWaitAge=error.age)
                    if self.state["startedAt"] is None:
                        self.state["startedAt"] = time.time()
                    self.connected, self.feed = False, None
                    self.refresh_gap(problem=error)
                    self.worker.update(status="WAITING_QUOTES", cause=str(error), heartbeat=time.time())
                    try:
                        self.save()
                    except Exception as save_error:
                        self.halt(save_error, storage=True)
                        raise HTTPException(503, str(save_error)) from save_error
                    return self.snapshot()
                raise HTTPException(503, "Registre essai bloque : " + self.storage_fault) from error
            except Exception as error:
                message = str(getattr(error, "detail", error))
                if not self.storage_fault:
                    self.halt(error)
                raise HTTPException(503, message) from error
            return self.snapshot()

    def close_position(self, price, reason, feed):
        s, p = self.state, self.state["position"]
        gross = (price - p["entry"]) * p["side"] * p["contract"] * p["lots"]
        net = (gross - s["commissionUSD"] * p["lots"]) / feed["fx"]
        s["balance"] += net
        s["cashEvents"].append({"phase": 1, "time": feed["time"], "amount": net, "type": "EXIT_NET"})
        s["trades"].append({**p, "exit": price, "exitTime": feed["time"], "reason": reason,
                            "pnl": net - p["entryCommissionEUR"], "grossUSD": gross,
                            "exitFX": feed["fx"], "balance": s["balance"]})
        s["position"] = None
        if reason != "TIME":
            s["lastSignal"] = int(feed["time"] // 900) * 900
        mark(s, s["balance"], feed["time"])

    def observe(self, feed):
        s, now = self.state, feed["time"]
        guard = self.refresh_gap(feed)
        if guard["marketOpen"] is False:
            self.refresh_gap(feed, problem="Fermeture atteinte : position conservee, aucune sortie tardive supposee.")
            return
        reset_day(s, now)
        p = s["position"]
        if p and guard["closeDue"]:
            wall_now = time.time()
            if wall_now >= guard["weeklyClose"]:
                self.refresh_gap(feed, problem="Fermeture atteinte pendant le controle : aucune execution tardive.")
                return
            for symbol, key in ((FTMO_SYMBOL, "time"), ("EURUSD", "fxTime")):
                if not isinstance(feed.get(key), (int, float)) or not math.isfinite(feed[key]):
                    raise ValueError("Horodatage de cotation invalide : sortie anti-gap refusee.")
                age = wall_now-feed[key]
                if age > 15:
                    raise StaleQuoteError(symbol, age)
                if age < 0:
                    raise ValueError("Cotation future : sortie anti-gap refusee.")
            if any(not math.isfinite(float(feed[key])) or float(feed[key]) <= 0 for key in ("bid", "ask", "fx")) or feed["ask"] < feed["bid"]:
                raise ValueError("BID/ASK/FX non finis ou incoherents : sortie anti-gap refusee.")
            if not math.isfinite(float(s["commissionUSD"])) or s["commissionUSD"] < 0 or not math.isfinite(float(s["slippageUSD"])) or s["slippageUSD"] < 0:
                raise ValueError("Couts de simulation invalides : sortie anti-gap refusee.")
            if p.get("timeBasis") != feed["timeBasis"]:
                raise ValueError("Identite de la position differente : sortie anti-gap refusee.")
            price = (feed["bid"] if p["side"] == 1 else feed["ask"]) - p["side"] * s["slippageUSD"]
            self.close_position(price, "WEEKLY_CLOSE", feed)
            guard.update(status="CLOSED", reason=f"Cloture PAPER anti-gap enregistree a {price:g} USD, spread/slippage et commissions de simulation appliques.")
            s["antiGap"] = guard
            self.refresh_gap(feed)
            p = None
        if p:
            price = (feed["bid"] if p["side"] == 1 else feed["ask"]) - p["side"] * s["slippageUSD"]
            equity = s["balance"] + ((price - p["entry"]) * p["side"] * p["contract"] * p["lots"] - s["commissionUSD"] * p["lots"]) / feed["fx"]
            reason = "RISK_LIMIT" if mark(s, equity, now) else None
            if not reason and ((p["side"] == 1 and feed["bid"] <= p["sl"]) or (p["side"] == -1 and feed["bid"] >= p["sl"])):
                reason = "SL"
            if not reason and ((p["side"] == 1 and feed["bid"] >= p["tp"]) or (p["side"] == -1 and feed["bid"] <= p["tp"])):
                reason = "TP"
            if not reason:
                with self.market_lock:
                    bars = self.mt5.copy_rates_from_pos(FTMO_SYMBOL, self.mt5.TIMEFRAME_M15, 1, 100)
                    if bars is None:
                        IPC_GATE.failure(self.mt5.last_error())
                    if bars is None or len(bars) == 0:
                        raise ValueError("Bougies M15 indisponibles pour la sortie temporelle.")
                    times = self.bases[FTMO_SYMBOL].bars([float(bar["time"]) for bar in bars])
                if sum(stamp >= p["signalTime"] for stamp in times) >= 32:
                    reason = "TIME"
            if reason:
                self.close_position(price, reason, feed)
        else:
            mark(s, s["balance"], now)
        if s["running"] and s["status"] != "FAILED" and s["position"] is None and guard["entriesAllowed"]:
            bucket = int(now // 900) * 900
            if bucket != s["lastSignal"]:
                s["lastSignal"] = bucket
                if now - bucket <= 10:
                    frames = self.frames()
                    side, distance, timestamp = frozen_signal(frames)
                    s["lastSignalResult"] = {"time": bucket, "side": side}
                    if abs(timestamp.value / 1e9 - bucket) <= 1 and side in (-1, 1):
                        current = self.market()
                        if int(current["time"] // 900) * 900 != bucket or time.time() - bucket > 10:
                            s["lastObserved"], s["lastQuote"] = current["time"], current
                            return
                        if current["timeBasis"] != feed["timeBasis"]:
                            raise ValueError("Identite MT5 modifiee pendant le calcul du signal.")
                        if not self.refresh_gap(current)["entriesAllowed"]:
                            s["lastObserved"], s["lastQuote"] = current["time"], current
                            return
                        feed, now = current, current["time"]
                        c = feed["contract"]
                        lots, risk = volume(s["equity"], feed["bid"], distance, feed["fx"], c["size"], c["minLot"], c["step"], c["maxLot"], feed["spread"], s["slippageUSD"], s["commissionUSD"])
                        if lots:
                            entry = (feed["ask"] if side == 1 else feed["bid"]) + side * s["slippageUSD"]
                            commission = lots * s["commissionUSD"] / feed["fx"]
                            s["balance"] -= commission
                            s["cashEvents"].append({"phase": 1, "time": now, "amount": -commission, "type": "ENTRY_COMMISSION"})
                            s["position"] = {"phase": 1, "entryTime": now, "signalTime": bucket, "entry": entry,
                                             "timeBasis": feed["timeBasis"], "referenceBid": feed["bid"], "side": side,
                                             "lots": lots, "contract": c["size"], "sl": feed["bid"] - side * distance,
                                             "tp": feed["bid"] + side * distance * s["tpR"], "riskEUR": risk,
                                             "entryFX": feed["fx"], "entryCommissionEUR": commission, "swapsEUR": 0.}
                            price = (feed["bid"] if side == 1 else feed["ask"]) - side * s["slippageUSD"]
                            equity = s["balance"] + ((price - entry) * side * c["size"] * lots - lots * s["commissionUSD"]) / feed["fx"]
                            if mark(s, equity, now):
                                self.close_position(price, "RISK_LIMIT", feed)
        s["lastObserved"], s["lastQuote"] = now, feed
        if not s["curve"] or now - s["curve"][-1]["time"] >= 60:
            s["curve"].append({"time": now, "equity": s["equity"], "balance": s["balance"], "phase": 1})

    def cycle(self):
        with self.lock:
            self.worker["heartbeat"] = time.time()
            if self.storage_fault:
                self.worker["status"] = "SAFE_STOP"
                return
            old_gap_key = self.state.get("gapEventKey")
            guard = self.refresh_gap(record=False)
            if self.state.get("monitoringBlocked") or not self.state["running"]:
                self.worker["status"] = "SAFE_STOP" if self.state.get("monitoringBlocked") else "STOPPED"
                retry = getattr(self, "ipc_retry", None)
                if retry and retry[0] < 2 and time.monotonic() >= retry[1]:
                    self.ipc_retry = (retry[0]+1, time.monotonic()+30)
                    try:
                        with self.market_lock:
                            self.connect()
                        self.ipc_retry = None
                        logging.info("MT5 IPC : liaison retablie; SAFE_STOP conserve, reprise explicite et controles PAPER requis.")
                    except Exception:
                        logging.warning("MT5 IPC : reconnexion %s/2 echouee; SAFE_STOP conserve", retry[0]+1)
                self.refresh_gap(problem="Reprise explicite requise : le moteur arrete/bloque n'est pas reactive automatiquement.")
                if old_gap_key != self.state.get("gapEventKey"):
                    try:
                        self.save()
                    except Exception as error:
                        self.halt(error, storage=True)
                return
            before = deepcopy(self.state)
            try:
                if guard["marketOpen"] is False:
                    self.refresh_gap(problem="Marche ferme : aucune execution sur un ancien tick.")
                    self.connected, self.feed = False, None
                    self.worker.update(status="WAITING_MARKET", cause=self.state["antiGap"]["reason"])
                    self.save()
                    return
                if self.challenge is not None:
                    with self.challenge.lock:
                        if self.challenge.state["running"] or self.challenge.state["position"] is not None:
                            raise ValueError("Challenge devenu actif : essai suspendu, aucune nouvelle position.")
                feed = self.market()
                if self.state.get("quoteWaiting"):
                    self.state.update(quoteWaiting=False, quoteWaitReason=None, quoteWaitAge=None, error="")
                if self.state["position"] and self.state["position"].get("timeBasis") != feed["timeBasis"]:
                    raise ValueError("Compte ou base temporelle modifies pendant une position.")
                previous = self.state["lastObserved"]
                if previous and feed["time"] - previous > 15:
                    self.state["verifiedContinuous"] = False
                    self.state["interruptions"].append({"from": previous, "to": feed["time"], "reason": "Interruption : excursions intrabar inconnues."})
                    if self.state["position"]:
                        raise ValueError("Suivi interrompu avec position : valorisation figee, reprise explicite requise.")
                    self.state["lastSignal"] = int(feed["time"] // 900) * 900
                self.feed_time = feed["time"]
                if before.get("quoteWaiting"):
                    self.frames()
                    if not previous:
                        self.state["lastSignal"] = int(feed["time"] // 900) * 900
                self.observe(feed)
                market_closed = self.state.get("antiGap", {}).get("marketOpen") is False
                self.feed, self.connected = (None, False) if market_closed else (feed, True)
                self.state["error"] = ""
                self.save()
                self.worker.update(status="WAITING_MARKET" if market_closed else "MONITORING" if self.state["running"] else "MANAGING_POSITION", cause=None)
            except StaleQuoteError as error:
                if not self.storage_fault:
                    self.state = before
                    self.state.update(running=True, monitoringBlocked=False, quoteWaiting=True, error=str(error),
                                      quoteWaitReason=str(error), quoteWaitAge=error.age)
                    self.connected, self.feed = False, None
                    self.refresh_gap(problem=error)
                    self.worker.update(status="WAITING_QUOTES", cause=str(error))
                    try:
                        self.save()
                    except Exception as save_error:
                        self.halt(save_error, storage=True)
            except Exception as error:
                if not self.storage_fault:
                    self.state = before
                    self.halt(error)
                    self.refresh_gap(problem=error)
                    try:
                        self.save()
                    except Exception:
                        pass

    def pause(self):
        with self.lock:
            self.ipc_retry = None
            self.state.update(running=False, quoteWaiting=False, quoteWaitReason=None, quoteWaitAge=None)
            self.state["error"] = ""
            self.save()
            self.worker.update(status="STOPPED", cause=None)
            return self.snapshot()

    def loop(self):
        try:
            while not self.stop_event.wait(2):
                self.cycle()
        except Exception as error:
            with self.lock:
                self.halt(error)
            logging.exception("ESSAI PAPER : worker interrompu")
