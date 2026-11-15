"""V87 MT5 observation only. No orders, initialization, PAPER or challenge access."""
import hashlib
import json
import math
import threading
import time


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return value


def identity(value):
    # Tickets/identifiers must not lose precision when serialized to JavaScript.
    return str(value) if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def account_mode(mt5, account):
    raw = getattr(account, "margin_mode", None)
    if raw is None:
        return "UNKNOWN"
    if raw == getattr(mt5, "ACCOUNT_MARGIN_MODE_RETAIL_HEDGING", None):
        return "HEDGING"
    modes = [getattr(mt5, name, None) for name in ("ACCOUNT_MARGIN_MODE_RETAIL_NETTING", "ACCOUNT_MARGIN_MODE_EXCHANGE")]
    return "NETTING" if raw in modes else "UNKNOWN"


def provenance(mt5, position, mode):
    reason = getattr(position, "reason", None)
    magic = getattr(position, "magic", None)
    if mode == "NETTING":
        return "NETTING_AGGREGATE"
    manual_reasons = [getattr(mt5, name, None) for name in ("POSITION_REASON_CLIENT", "POSITION_REASON_MOBILE", "POSITION_REASON_WEB")]
    if reason is not None and reason == getattr(mt5, "POSITION_REASON_EXPERT", None):
        return "EXTERNAL_AUTOMATION"
    if mode == "HEDGING" and reason is not None and reason in manual_reasons and magic == 0:
        return "MANUAL"
    return "UNCONFIRMED"


def exposure_review(account, positions):
    """Read-only prerequisites, NOT a monetary risk estimate or trading authorization."""
    return {"liveAllowed": False, "riskComplete": False, "riskAtStops": None,
            "balance": number(getattr(account, "balance", None)),
            "equity": number(getattr(account, "equity", None)),
            "margin": number(getattr(account, "margin", None)),
            "marginFree": number(getattr(account, "margin_free", None)),
            "brokerPositionCount": len(positions),
            "missingStops": sum(number(getattr(p, "sl", None)) in (None, 0) for p in positions),
            "pendingOrdersChecked": False, "paperIncluded": False}


def serialize(mt5, account, position, mode):
    ticket = identity(getattr(position, "ticket", None))
    identifier = identity(getattr(position, "identifier", None))
    if ticket is None or ticket == "0":
        raise ValueError("Ticket MT5 absent ou invalide")
    key = [str(account.server), str(account.login), identifier or ticket, ticket]
    uid = "MT5-" + hashlib.sha256(json.dumps(key, separators=(",", ":")).encode()).hexdigest()[:24]
    kind = getattr(position, "type", None)
    side = "BUY" if kind == getattr(mt5, "POSITION_TYPE_BUY", None) and kind is not None else "SELL" if kind == getattr(mt5, "POSITION_TYPE_SELL", None) and kind is not None else "UNKNOWN"
    return {"id": uid, "owner": "NOT_PAPER_BOT", "provenance": provenance(mt5, position, mode),
            "ticket": ticket, "identifier": identifier, "magic": identity(getattr(position, "magic", None)),
            "reason": number(getattr(position, "reason", None)), "symbol": str(getattr(position, "symbol", "")),
            "side": side, "volume": number(getattr(position, "volume", None)),
            "entry": number(getattr(position, "price_open", None)), "lastPrice": number(getattr(position, "price_current", None)),
            "sl": number(getattr(position, "sl", None)), "tp": number(getattr(position, "tp", None)),
            "profit": number(getattr(position, "profit", None)), "swap": number(getattr(position, "swap", None)),
            "timeRaw": number(getattr(position, "time", None)), "timeMscRaw": number(getattr(position, "time_msc", None)),
            "quoteFreshness": "UNVERIFIED"}


class ManualPositionsReader:
    def __init__(self, mt5, market_lock):
        self.mt5, self.market_lock = mt5, market_lock
        self.lock = threading.Lock()
        self.cached = None
        self.last_attempt = None

    def unavailable(self, status, now):
        return {"source": "MT5_ACCOUNT", "readOnly": True, "liveEnabled": False,
                "available": False, "status": status, "observedAt": None,
                "checkedAt": now, "account": None, "positions": [], "exposure": None}

    def read(self):
        now = time.time()
        if not self.lock.acquire(blocking=False):
            return self.unavailable("BUSY", now)
        try:
            # All callers share a 5 s throttle, including unsuccessful native reads.
            if self.last_attempt is not None and 0 <= now-self.last_attempt < 5:
                return self.cached
            if not self.market_lock.acquire(blocking=False):
                return self.unavailable("BUSY", now)
            try:
                self.last_attempt = now
                mt5 = self.mt5
                terminal = mt5.terminal_info()
                if terminal is None or not terminal.connected:
                    self.cached = self.unavailable("DISCONNECTED", now)
                    return self.cached
                before = mt5.account_info()
                positions = mt5.positions_get()
                after = mt5.account_info()
                if before is None or after is None or positions is None:
                    self.cached = self.unavailable("UNAVAILABLE", now)
                    return self.cached
                if (before.login, before.server, getattr(before, "margin_mode", None)) != (after.login, after.server, getattr(after, "margin_mode", None)):
                    self.cached = self.unavailable("ACCOUNT_CHANGED", now)
                    return self.cached
                if len(positions) > 1000:
                    self.cached = self.unavailable("TOO_MANY_POSITIONS", now)
                    return self.cached
                mode = account_mode(mt5, after)
                account_type = "DEMO" if after.trade_mode == getattr(mt5, "ACCOUNT_TRADE_MODE_DEMO", None) else "REAL" if after.trade_mode == getattr(mt5, "ACCOUNT_TRADE_MODE_REAL", None) else "CONTEST" if after.trade_mode == getattr(mt5, "ACCOUNT_TRADE_MODE_CONTEST", None) else "UNKNOWN"
                self.cached = {"source": "MT5_ACCOUNT", "readOnly": True, "liveEnabled": False,
                               "available": True, "status": "OBSERVED", "observedAt": time.time(), "checkedAt": now,
                               "account": {"login": str(after.login), "server": str(after.server),
                                           "currency": str(after.currency), "type": account_type,
                                           "mode": mode, "marginModeRaw": number(getattr(after, "margin_mode", None))},
                               "positions": [serialize(mt5, after, p, mode) for p in positions],
                               "exposure": exposure_review(after, positions)}
                return self.cached
            except Exception:
                # No native error dump: broker details do not belong in logs.
                self.cached = self.unavailable("UNAVAILABLE", now)
                return self.cached
            finally:
                self.market_lock.release()
        finally:
            self.lock.release()


def register_manual_positions_route(app, reader):
    @app.get("/paper-monitor/manual-positions")
    def manual_positions():
        return reader.read()
