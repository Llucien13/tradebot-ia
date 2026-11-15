"""One-shot IPC observation in the existing bridge; no initialization or safety reset."""
import math
import os
import platform
import struct
import sys
import time

from paper_time import configured_paper_basis, StaleQuoteError
from quote_time import tick_timestamp
from runtime_identity import source_hash, RELEASE


def register_ipc_diagnostic(app, mt, market_lock, gate, trial_getter, loaded_hash):
    @app.get("/diagnostics/mt5-ipc")
    def diagnostic():
        now = time.time()
        result = {"version": 92, "release": RELEASE, "observedAt": now, "mode": "PAPER", "liveEnabled": False,
                  "readOnly": True, "ordersSent": False, "testsRun": 0,
                  "python": {"executable": sys.executable, "version": sys.version,
                             "bits": struct.calcsize("P")*8, "prefix": sys.prefix,
                             "basePrefix": sys.base_prefix, "platform": platform.platform(),
                             "mt5Version": str(mt.__version__), "mt5Module": str(mt.__file__),
                             "pid": os.getpid(), "cwd": os.getcwd(), "configuredTerminal": os.environ.get("MT5_TERMINAL_PATH"),
                             "configuredTerminalResolved": os.path.abspath(os.environ["MT5_TERMINAL_PATH"].strip()) if os.environ.get("MT5_TERMINAL_PATH", "").strip() else None},
                  "runtime": {"loadedSha256": loaded_hash, "diskSha256": source_hash()},
                  "ipc": {"attempts": gate.attempts, "failed": gate.failed,
                          "exhausted": gate.failed and gate.attempts >= 3,
                          "retryInSeconds": max(0., gate.next_attempt-time.monotonic()) if gate.failed else 0.},
                  "findings": [], "ticks": [], "terminal": None, "account": None}
        if not market_lock.acquire(blocking=False):
            result["findings"].append("MARKET_LOCK_BUSY : lecture differee, pas une preuve de panne IPC.")
        else:
            try:
                terminal = mt.terminal_info()
                if terminal is None:
                    result["lastError"] = list(mt.last_error())
                    result["findings"].append("TERMINAL_INFO_UNAVAILABLE : liaison API non lisible dans ce processus; aucune reinitialisation effectuee.")
                else:
                    result["terminal"] = {"path": terminal.path, "dataPath": terminal.data_path,
                                          "connected": bool(terminal.connected), "build": terminal.build}
                    if not terminal.connected:
                        result["findings"].append("BROKER_DISCONNECTED : terminal joignable, serveur non connecte.")
                    account = mt.account_info()
                    if account is None:
                        result["lastError"] = list(mt.last_error())
                        result["findings"].append("ACCOUNT_UNAVAILABLE : aucun compte suppose.")
                    else:
                        demo = account.trade_mode == mt.ACCOUNT_TRADE_MODE_DEMO and str(account.server).casefold().startswith("ftmo-demo")
                        result["account"] = {"login": str(account.login), "server": str(account.server),
                                             "tradeMode": account.trade_mode, "ftmoDemo": demo}
                        if not demo:
                            result["findings"].append("EXPECTED_DEMO_NOT_CONFIRMED : aucune lecture de prix PAPER validee.")
                        elif terminal.connected:
                            for symbol in ("XAUUSD", "EURUSD"):
                                item = {"symbol": symbol, "fresh": False, "normalizedUTC": None, "ageSeconds": None}
                                tick = mt.symbol_info_tick(symbol)
                                if tick is None:
                                    item["error"] = list(mt.last_error())
                                else:
                                    item.update(rawTime=tick.time, rawTimeMsc=tick.time_msc)
                                    try:
                                        read_at = time.time()
                                        basis = configured_paper_basis(mt, account, read_at)
                                        raw = tick_timestamp(tick)
                                        normalized = basis.basis_for_tick(raw, read_at, symbol).tick(tick, symbol, read_at)
                                        valid_price = all(math.isfinite(v) and v > 0 for v in (tick.bid, tick.ask)) and tick.ask >= tick.bid
                                        item.update(normalizedUTC=normalized, ageSeconds=read_at-normalized,
                                                    fresh=valid_price and 0 <= read_at-normalized <= 15)
                                    except StaleQuoteError as error:
                                        item.update(ageSeconds=error.age, error=str(error))
                                    except (ValueError, TypeError, AttributeError) as error:
                                        item["error"] = str(error)
                                result["ticks"].append(item)
                            final_account = mt.account_info()
                            if final_account is None or (str(final_account.login), str(final_account.server)) != (str(account.login), str(account.server)):
                                result["findings"].append("ACCOUNT_CHANGED_DURING_READ : cotations non certifiables.")
                                for item in result["ticks"]:
                                    item["fresh"] = False
            except Exception as error:
                result["findings"].append("DIAGNOSTIC_READ_ERROR : " + str(error))
                for item in result["ticks"]:
                    item["fresh"] = False
            finally:
                market_lock.release()
        # Never take trial.lock while holding the market lock (worker uses inverse order).
        trial = trial_getter()
        if trial is not None and trial.lock.acquire(blocking=False):
            try:
                snapshot = trial.snapshot()
                state = snapshot["state"]
                result["paper"] = {"connected": snapshot["connected"], "valuationFresh": snapshot["valuationFresh"],
                                   "worker": snapshot["worker"], "running": state["running"],
                                   "monitoringBlocked": state.get("monitoringBlocked"), "error": state.get("error"),
                                   "positionPresent": state.get("position") is not None,
                                   "timeBasis": (state.get("lastQuote") or {}).get("timeBasis")}
            finally:
                trial.lock.release()
        else:
            result["findings"].append("PAPER_SNAPSHOT_UNAVAILABLE_OR_BUSY : aucun heartbeat suppose.")
        if gate.failed:
            result["findings"].append("IPC_GATE_LATCHED : le diagnostic ne remet ni compteur ni SAFE_STOP a zero.")
        if loaded_hash != result["runtime"]["diskSha256"]:
            result["findings"].append("BRIDGE_SOURCES_STALE : processus different des fichiers sur disque.")
        result["finishedAt"] = time.time()
        return result
