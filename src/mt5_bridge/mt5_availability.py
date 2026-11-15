"""Read-only session evidence and bounded IPC retry gate."""
import logging
import time
from datetime import datetime, timezone

from fastapi import HTTPException
from paper_time import StaleQuoteError
from server_clock import confirmed_server_clock
from time_basis import _read_native_proof


class MarketPause(StaleQuoteError):
    def __init__(self, symbol):
        super().__init__(symbol, 0.)
        self.args = (f"MARCHE FERME / EN ATTENTE DE COTATIONS : session MT5 {symbol} fermee (releve natif recent).",)


def confirmed_pause(terminal, account, now):
    """Unknown/expired evidence never proves a normal market pause."""
    try:
        proof = _read_native_proof(terminal)
        if (proof.get("tester") is not False or proof.get("server") != account.server
                or str(proof.get("login")) != str(account.login)
                or not 0 <= now-float(proof["timeGMT"]) <= 120):
            return None
        clock = confirmed_server_clock(proof, now)
        offset = clock.offset(now)
        wall = datetime.fromtimestamp(now+offset, timezone.utc)
        day = (wall.weekday()+1) % 7
        second = wall.hour*3600+wall.minute*60+wall.second
        for symbol in ("XAUUSD", "EURUSD"):
            evidence = proof["tradeSessions"][symbol]
            if evidence.get("complete") is not True or evidence.get("day") != day:
                return None
            intervals = evidence["intervals"]
            if not intervals:
                return None  # Empty can also mean unsupported symbol/API.
            active = False
            for start, end in intervals:
                if not (0 <= start < end <= 86400):
                    return None
                active |= start <= second < end
            if not active:
                return symbol
    except (ValueError, TypeError, KeyError, AttributeError):
        pass
    return None


class MT5IPCError(HTTPException):
    def __init__(self, detail):
        super().__init__(503, detail)


class IPCGate:
    def __init__(self):
        self.attempts = 0
        self.next_attempt = 0.
        self.failed = False

    def check(self):
        if self.failed and (self.attempts >= 3 or time.monotonic() < self.next_attempt):
            raise HTTPException(503, "MT5 IPC SAFE_STOP : reconnexion differee ou 3 tentatives epuisees; intervention requise.")

    def failure(self, error):
        code = error[0] if isinstance(error, (tuple, list)) and error else None
        if code not in (-10000, -10001, -10002, -10003, -10004, -10005):
            return
        self.failed = True
        self.attempts += 1
        self.next_attempt = time.monotonic()+min(120, 15*2**(self.attempts-1))
        logging.error("MT5 IPC code=%s tentative=%s/3; liaison non fiable, aucun ordre", code, self.attempts)
        raise MT5IPCError(f"MT5 IPC {code} : liaison non fiable; tentative {self.attempts}/3, SAFE_STOP maintenu.")

    def success(self):
        self.attempts = 0
        self.next_attempt = 0.
        self.failed = False


IPC_GATE = IPCGate()
