"""TradeBot IA: local MT5 data only. No login or order API."""
import math
import os
import re
import threading
import logging
import sys
from pathlib import Path
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import urlsplit

import MetaTrader5 as mt5
import psutil
import uvicorn
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from ftmo_service import FTMOService
from quote_time import tick_timestamp
from time_basis import load_time_basis
from clock_evidence import clock_evidence, run_clock_tests
from runtime_identity import source_hash
from paper_trial import PaperTrial
from paper_monitor import PaperMonitor
from monitor_routes import register_monitor_routes
from manual_positions import ManualPositionsReader, register_manual_positions_route
from mt5_availability import IPC_GATE
from ipc_diagnostic_v91 import register_ipc_diagnostic

LOADED_SOURCE_HASH = source_hash()
SYMBOL = "XAUUSD"
TIMEFRAMES = {"M1": mt5.TIMEFRAME_M1, "M5": mt5.TIMEFRAME_M5,
              "M15": mt5.TIMEFRAME_M15, "M30": mt5.TIMEFRAME_M30,
              "H1": mt5.TIMEFRAME_H1, "H4": mt5.TIMEFRAME_H4, "D1": mt5.TIMEFRAME_D1}
ORIGIN_PATTERN = r"^http://(?:127\.0\.0\.1|localhost)(?::[0-9]{1,5})?$"
LOCK = threading.RLock()


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def failure(message):
    raise HTTPException(status_code=503, detail=message)


def finite(value):
    number = float(value)
    if not math.isfinite(number):
        failure("MT5 a retourne une valeur non finie. Aucune donnee de remplacement.")
    return number


def connect():
    # Target only an already running terminal; initialize cannot silently open another one.
    paths = set()
    terminal_paths = []
    for process in psutil.process_iter(["name", "exe"]):
        try:
            if (process.info["name"] or "").lower() == "terminal64.exe" and process.info["exe"]:
                path = os.path.normcase(os.path.abspath(process.info["exe"]))
                paths.add(path)
                terminal_paths.append(path)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    chosen = os.environ.get("MT5_TERMINAL_PATH", "").strip()
    if chosen:
        chosen = os.path.normcase(os.path.abspath(chosen))
        if chosen not in paths:
            failure("MT5_TERMINAL_PATH ne correspond pas a un terminal MT5 ouvert. Ouvrez ce terminal sous le meme utilisateur Windows.")
    elif len(paths) == 1:
        chosen = next(iter(paths))
    elif len(paths) > 1:
        failure("Plusieurs terminaux MT5 ouverts. Fermez les autres ou configurez MT5_TERMINAL_PATH selon INSTALLATION.md.")
    else:
        failure("Aucun terminal64.exe accessible. Ouvrez MT5 Windows 64 bits, deja connecte, sous le meme utilisateur Windows que cette passerelle.")
    if terminal_paths.count(chosen) != 1:
        failure("Plusieurs processus MT5 utilisent le meme executable : instance ambigue, aucune reconnexion automatique.")
    # Never reset a working IPC link for each quote/API request. Keep the retry gate latched.
    IPC_GATE.check()
    terminal = mt5.terminal_info()
    if terminal is None:
        if not mt5.initialize(path=chosen, timeout=10000):
            error = mt5.last_error()
            IPC_GATE.failure(error)
            failure('Initialisation MT5 impossible : ' + str(error))
        terminal = mt5.terminal_info()
    if terminal is None or not terminal.connected:
        if terminal is None:
            IPC_GATE.failure(mt5.last_error())
        failure('MT5 non connecte au serveur du broker.')
    returned = os.path.normcase(os.path.abspath(os.path.join(terminal.path, "terminal64.exe")))
    if returned != chosen:
        failure("MT5 a retourne un autre terminal que celui selectionne. Lecture refusee, liaison non reinitialisee.")
    account = mt5.account_info()
    if account is None:
        error = mt5.last_error()
        IPC_GATE.failure(error)
        failure("Compte MT5 inaccessible : " + str(error))
    IPC_GATE.success()
    return terminal, account


def quote(symbol=SYMBOL):
    if not mt5.symbol_select(symbol, True):
        failure(symbol + " indisponible dans ce terminal : " + str(mt5.last_error()))
    info = mt5.symbol_info(symbol)
    tick = mt5.symbol_info_tick(symbol)
    if info is None or tick is None or tick.time <= 0 or tick.bid <= 0 or tick.ask <= 0:
        failure("Pas de cotation BID/ASK valide pour " + symbol + ". Verifiez l'Observation du marche ; aucun prix fictif.")
    try:
        if symbol == "XAUUSD":
            terminal, account = connect()
            timestamp = load_time_basis(mt5, terminal, account).tick(tick, symbol)
        else:
            timestamp = tick_timestamp(tick)
    except ValueError as error:
        failure(str(error))
    return {"bid": finite(tick.bid), "ask": finite(tick.ask),
            "time": round(timestamp * 1000), "digits": int(info.digits),
            "maxLot": finite(info.volume_max)}


ftmo = None
ftmo_error = ""
trial = None
trial_error = ""
monitor = None


@asynccontextmanager
async def lifespan(app):
    global ftmo, ftmo_error, trial, trial_error, monitor
    try:
        ftmo = FTMOService(mt5, connect, LOCK)
        ftmo.thread.start()
    except Exception as error:
        ftmo_error = str(error)
        logging.exception("FTMO SAFE_STOP : initialisation refusee")
    try:
        trial = PaperTrial(mt5, connect, LOCK, ftmo)
        trial.thread.start()
    except Exception as error:
        trial_error = str(error)
        logging.exception("ESSAI PAPER : initialisation refusee, challenge inchange")
    if trial is not None:
        try:
            monitor = PaperMonitor(trial)
            monitor.start()
        except Exception:
            logging.error("Monitoring V86 indisponible; moteur PAPER V85 inchange")
            monitor = None
    yield
    if monitor is not None:
        try:
            monitor.close()
        except Exception:
            logging.error("Arret observateur V86 incomplet; arret V85 maintenu")
    for service in (trial, ftmo):
        if service is None:
            continue
        service.stop_event.set()
        service.thread.join(timeout=5)
        with service.lock:
            try:
                service.state["running"] = False
                if not service.storage_fault and not service.thread.is_alive():
                    service.save()
            except Exception:
                logging.exception("PAPER : sauvegarde finale impossible")
            finally:
                if not service.thread.is_alive():
                    service.storage.close()
    with LOCK:
        mt5.shutdown()


app = FastAPI(title="TradeBot IA - MT5 lecture seule", lifespan=lifespan,
              docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(CORSMiddleware, allow_origin_regex=ORIGIN_PATTERN,
                   allow_methods=["GET", "POST"], allow_headers=["Accept", "Content-Type"], allow_credentials=False)
register_monitor_routes(app, lambda: monitor)
register_manual_positions_route(app, ManualPositionsReader(mt5, LOCK))
register_ipc_diagnostic(app, mt5, LOCK, IPC_GATE, lambda: trial, LOADED_SOURCE_HASH)


@app.middleware("http")
async def local_only(request: Request, call_next):
    host = urlsplit(str(request.url)).hostname
    origin = request.headers.get("origin")
    if (host not in {"127.0.0.1", "localhost"}
            or not request.client or request.client.host not in {"127.0.0.1", "::1"}
            or (origin is not None and re.fullmatch(ORIGIN_PATTERN, origin) is None)):
        return JSONResponse(status_code=403, content={"detail": "Acces local uniquement. Origine HTTP localhost ou 127.0.0.1 requise."})
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    # Older Chromium private-network preflight; the origin was checked above.
    if request.method == "OPTIONS" and request.headers.get("access-control-request-private-network") == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


@app.get("/status")
def status(symbol: Literal["XAUUSD", "XAUUSD-ECN"] = SYMBOL):
    with LOCK:
        base = {"source": "MT5", "readOnly": True, "mode": "PAPER", "liveEnabled": False,
                "botState": "STOPPED", "symbol": symbol, "fetchedAt": utc_now(),
                "packageVersion": str(mt5.__version__)}
        try:
            terminal, account = connect()
            account_type = {mt5.ACCOUNT_TRADE_MODE_DEMO: "DEMO", mt5.ACCOUNT_TRADE_MODE_REAL: "REAL",
                            mt5.ACCOUNT_TRADE_MODE_CONTEST: "CONTEST"}.get(account.trade_mode, "UNKNOWN")
            base.update({"connected": True, "terminal": {"name": terminal.name, "path": terminal.path},
                         "account": {"type": account_type, "login": str(account.login),
                                     "server": account.server, "company": account.company,
                                     "currency": account.currency, "balance": finite(account.balance),
                                     "equity": finite(account.equity)}, "quote": None, "quoteError": None})
            try:
                base["quote"] = quote(symbol)
            except HTTPException as error:
                base["quoteError"] = str(error.detail)
            base["fetchedAt"] = utc_now()
            return base
        except HTTPException as error:
            return {**base, "fetchedAt": utc_now(), "connected": False, "error": str(error.detail)}


@app.get("/candles")
def candles(timeframe: Literal["M1", "M5", "M15", "M30", "H1", "H4", "D1"] = "M5",
            count: int = Query(default=300, ge=1, le=2000),
            symbol: Literal["XAUUSD", "XAUUSD-ECN"] = SYMBOL):
    with LOCK:
        connect()
        if not mt5.symbol_select(symbol, True):
            failure("Symbole " + symbol + " absent du terminal. Aucun autre symbole ne sera substitue.")
        # Position 0 is forming: return only closed bars, directly from the terminal.
        rates = mt5.copy_rates_from_pos(symbol, TIMEFRAMES[timeframe], 1, count)
        if rates is None or len(rates) == 0:
            failure("Bougies MT5 indisponibles : " + str(mt5.last_error()) + ". Ouvrez le graphique correspondant et attendez sa synchronisation.")
        try:
            if symbol == "XAUUSD":
                terminal, account = connect()
                times = load_time_basis(mt5, terminal, account).bars([r["time"] for r in rates])
            else:
                times = [int(r["time"]) for r in rates]
        except ValueError as error:
            failure(str(error))
        rows = [{"time": round(stamp * 1000), "open": finite(r["open"]), "high": finite(r["high"]),
                 "low": finite(r["low"]), "close": finite(r["close"]), "tickVolume": int(r["tick_volume"]),
                 "realVolume": int(r["real_volume"]), "spreadPoints": int(r["spread"])} for r, stamp in zip(rates, times)]
        return {"source": "MT5", "readOnly": True, "symbol": symbol, "timeframe": timeframe,
                "closedBarsOnly": True, "fetchedAt": utc_now(), "requestedCount": count, "candles": rows}


class FTMOStart(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    swapLongUSD: float | None = Field(default=None, ge=-10000, le=10000)
    swapShortUSD: float | None = Field(default=None, ge=-10000, le=10000)
    swapHourUTC: int | None = Field(default=None, ge=0, le=23)
    commissionUSD: float = Field(default=3.0, ge=0, le=10000)
    slippageUSD: float = Field(default=.05, ge=0, le=100)


def ftmo_module():
    if ftmo is None:
        raise HTTPException(503, "Module FTMO indisponible : " + ftmo_error)
    return ftmo


def paper_trial_module():
    if trial is None:
        raise HTTPException(503, "Essai PAPER indisponible : " + trial_error)
    return trial


@app.get("/paper-trial/state")
def paper_trial_state():
    return paper_trial_module().snapshot()


@app.post("/paper-trial/start")
def paper_trial_start():
    return paper_trial_module().start()


@app.post("/paper-trial/stop")
def paper_trial_stop():
    return paper_trial_module().pause()


@app.get("/ftmo/state")
def ftmo_state():
    return {**ftmo_module().snapshot(), "runtimeBuild": {"sourceSha256": LOADED_SOURCE_HASH,
            "diskSha256": source_hash(), "pid": os.getpid(), "python": sys.executable,
            "entry": str(Path(__file__).resolve())}}


@app.get("/ftmo/clock-evidence")
def ftmo_clock_evidence():
    with LOCK:
        terminal, account = connect()
        if account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO or not str(account.server).casefold().startswith("ftmo-demo"):
            failure("Releve reserve au compte DEMO FTMO-Demo.")
        return clock_evidence(mt5, terminal, account)


@app.get("/ftmo/feed")
def ftmo_feed():
    tests = run_clock_tests()
    if not tests["passed"]:
        failure("Autotests des horodatages en echec : flux bloque. Consultez le releve croise des horloges.")
    return ftmo_module().test_connection()


@app.post("/ftmo/start")
def ftmo_start(config: FTMOStart):
    try:
        return ftmo_module().start(config.model_dump())
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(503, str(getattr(error, "detail", error))) from error


@app.post("/ftmo/stop")
def ftmo_stop():
    return ftmo_module().pause()


@app.post("/ftmo/reset")
def ftmo_reset():
    return ftmo_module().reset()


@app.get("/ftmo/references")
def ftmo_references():
    return ftmo_module().references()


@app.get("/ftmo/reference-trades")
def ftmo_reference_trades(year: Literal[2025, 2026] = 2025, tp: Literal["2p5", "5"] = "2p5"):
    import pandas as pd
    from ftmo_service import FTMO_ROOT
    ftmo_module()
    file = FTMO_ROOT / "reference" / "resultats" / f"ftmo_20k_{year}_tp{tp}_trades.csv"
    return {"trades": pd.read_csv(file).to_dict(orient="records")}


@app.post("/ftmo/verify")
def ftmo_verify():
    return ftmo_module().verify()


if __name__ == "__main__":
    # Never bind to 0.0.0.0; one process serializes access to the official MT5 API.
    uvicorn.run(app, host="127.0.0.1", port=8765, workers=1, access_log=False)
