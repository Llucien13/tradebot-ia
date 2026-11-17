#!/usr/bin/env python3
"""Loopback-only, read-only view of the persisted PAPER register for Cloud sync."""

import hashlib
import json
import math
import os
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


HOST = "127.0.0.1"
PORT = 8765
INITIAL_CAPITAL = 20_000
MAX_TRADES = 100_000
MAX_PAGE_SIZE = 100
REGISTER = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "TradeBotIA" / "essai-paper20k" / "essai.json"
TRADE_FIELDS = (
    "entryTime", "signalTime", "entry", "side", "lots", "sl", "tp", "riskEUR",
    "exitTime", "exit", "pnl", "reason", "entryReason",
)


class ObserverError(Exception):
    pass


def _finite(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ObserverError(f"Registre PAPER invalide : {label}.")
    return value


def _read_register():
    try:
        raw = REGISTER.read_bytes()
        state = json.loads(raw.decode("utf-8"))
    except FileNotFoundError as error:
        raise ObserverError("Registre PAPER indisponible.") from error
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ObserverError("Registre PAPER illisible; aucune donnée n’a été publiée.") from error

    if not isinstance(state, dict) or state.get("version") != 1 or state.get("mode") != "PAPER":
        raise ObserverError("Registre refusé : mode PAPER/version attendus.")
    if state.get("liveEnabled") is not False:
        raise ObserverError("Registre refusé : LIVE OFF non confirmé.")
    if state.get("trial") is not True:
        raise ObserverError("Registre refusé : registre de l’essai PAPER attendu.")
    if _finite(state.get("initialCapital", INITIAL_CAPITAL), "capital initial") != INITIAL_CAPITAL:
        raise ObserverError("Registre refusé : capital initial inattendu.")
    for key in ("balance", "equity"):
        _finite(state.get(key), key)

    trades = state.get("trades")
    position = state.get("position")
    if not isinstance(trades, list) or len(trades) > MAX_TRADES:
        raise ObserverError("Journal PAPER invalide ou trop volumineux.")
    if position is not None and not isinstance(position, dict):
        raise ObserverError("Position PAPER invalide.")
    records = trades + ([position] if position else [])
    for index, trade in enumerate(records):
        if not isinstance(trade, dict):
            raise ObserverError("Transaction PAPER invalide.")
        for field in ("entryTime", "signalTime", "entry", "side", "lots", "sl", "tp", "riskEUR"):
            _finite(trade.get(field), f"transaction {index}")
        if trade["side"] not in (-1, 1) or trade["lots"] <= 0 or trade["riskEUR"] < 0:
            raise ObserverError("Transaction PAPER incohérente.")
        if "exitTime" in trade:
            for field in ("exitTime", "exit", "pnl"):
                _finite(trade.get(field), f"clôture {index}")

    if len(records) > MAX_TRADES:
        raise ObserverError("Journal PAPER supérieur à la limite autorisée.")
    return state, records


def _trade_id(trade):
    identity = [trade.get(key) for key in ("phase", "signalTime", "entryTime", "side")]
    encoded = json.dumps(identity, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return "P-" + hashlib.sha256(encoded).hexdigest()[:20]


def _safe_trade(trade):
    return {key: trade[key] for key in TRADE_FIELDS if key in trade}


def read_snapshot(now=None):
    state, _ = _read_register()
    now = datetime.now(timezone.utc).timestamp() if now is None else _finite(now, "horodatage")
    trades = [trade for trade in state["trades"] if "exitTime" in trade]
    wins = sum(1 for trade in trades if trade["pnl"] > 0)
    losses = sum(1 for trade in trades if trade["pnl"] < 0)
    realized = sum(trade["pnl"] for trade in trades)

    position = state.get("position")
    safe_position = None
    if position is not None:
        safe_position = {
            **_safe_trade(position),
            "id": _trade_id(position),
            "instrument": "XAUUSD",
            "floatingEUR": None,
            "netPositionEUR": None,
            "percentInitial": None,
            "r": None,
            "riskPercentInitial": position["riskEUR"] / INITIAL_CAPITAL * 100,
            "needsReview": True,
        }

    if state.get("monitoringBlocked") or state.get("error"):
        status = "SAFE_STOP"
    elif state.get("quoteWaiting"):
        status = "WAITING_QUOTES"
    elif (state.get("antiGap") or {}).get("marketOpen") is False:
        status = "WAITING_MARKET"
    else:
        status = "STOPPED"

    return {
        "ready": True,
        "version": 86,
        "mode": "PAPER",
        "liveEnabled": False,
        "readOnly": True,
        "observedAt": now,
        "fresh": False,
        "status": status,
        "floatingEUR": None if position else 0.0,
        "position": safe_position,
        "metrics": {
            "initial": INITIAL_CAPITAL,
            "balance": _finite(state["balance"], "balance"),
            "realized": realized,
            "count": len(trades),
            "wins": wins,
            "losses": losses,
            "neutral": len(trades) - wins - losses,
            "winRate": wins / len(trades) * 100 if trades else None,
        },
        "health": {
            "mt5": "UNKNOWN",
            "worker": {
                "status": "SAFE_STOP" if status == "SAFE_STOP" else "STOPPED",
                "alive": False,
                "heartbeat": None,
            },
            "storageFault": False,
        },
    }


def read_journal(query):
    state, records = _read_register()
    params = parse_qs(query, keep_blank_values=False)
    try:
        start = float(params.get("start", ["0"])[0])
        end = float(params.get("end", ["4102444800"])[0])
        offset = int(params.get("offset", ["0"])[0])
        limit = int(params.get("limit", ["30"])[0])
    except (ValueError, OverflowError) as error:
        raise ObserverError("Paramètres de journal invalides.") from error
    if not all(math.isfinite(value) for value in (start, end)) or start < 0 or end < start:
        raise ObserverError("Période de journal invalide.")
    if not 0 <= offset <= 1_000_000 or not 1 <= limit <= MAX_PAGE_SIZE:
        raise ObserverError("Pagination de journal hors limites.")

    result = params.get("result", ["all"])[0]
    if result not in {"all", "win", "loss", "neutral", "open"}:
        raise ObserverError("Filtre de journal invalide.")
    matched = []
    for trade in records:
        exit_time = trade.get("exitTime", trade["entryTime"])
        if trade["entryTime"] > end or exit_time < start:
            continue
        pnl = trade.get("pnl")
        if result == "win" and not (pnl is not None and pnl > 0):
            continue
        if result == "loss" and not (pnl is not None and pnl < 0):
            continue
        if result == "neutral" and pnl != 0:
            continue
        if result == "open" and "exitTime" in trade:
            continue
        matched.append({
            "id": _trade_id(trade),
            "needsReview": "exitTime" not in trade and bool(state.get("monitoringBlocked") or not state.get("verifiedContinuous")),
            "trade": _safe_trade(trade),
        })
    matched.sort(key=lambda item: (item["trade"]["entryTime"], item["id"]), reverse=True)
    return {"total": len(matched), "offset": offset, "items": matched[offset:offset + limit]}


class ReadOnlyObserverServer(HTTPServer):
    allow_reuse_address = False


class Handler(BaseHTTPRequestHandler):
    server_version = "TradeBotPaperObserver/1"
    sys_version = ""

    def log_message(self, _format, *_args):
        return

    def _respond(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        host = self.headers.get("Host", "")
        if host not in {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}:
            self._respond(403, {"detail": "Loopback Host requis."})
            return
        path = urlsplit(self.path)
        try:
            if path.path == "/paper-monitor/state":
                self._respond(200, read_snapshot())
            elif path.path == "/paper-monitor/journal":
                self._respond(200, read_journal(path.query))
            else:
                self._respond(404, {"detail": "Route indisponible."})
        except ObserverError as error:
            self._respond(503, {"detail": str(error)})
        except (OSError, ValueError, TypeError, KeyError) as error:
            print(f"Observateur PAPER en lecture seule indisponible ({type(error).__name__}).", file=sys.stderr)
            self._respond(503, {"detail": "Registre PAPER temporairement indisponible."})

    def do_POST(self):
        self._respond(405, {"detail": "Observateur en lecture seule."})

    def do_PUT(self):
        self._respond(405, {"detail": "Observateur en lecture seule."})

    def do_DELETE(self):
        self._respond(405, {"detail": "Observateur en lecture seule."})


def main():
    server = ReadOnlyObserverServer((HOST, PORT), Handler)
    print("Observateur PAPER en lecture seule sur 127.0.0.1:8765; moteur et MT5 non initialisés.")
    try:
        server.serve_forever(poll_interval=1)
    except KeyboardInterrupt:
        print("\nObservateur arrêté.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
