"""Explicit PAPER-only server convention; never reads the challenge's native proof."""
import json
import math
import time
from datetime import datetime
from pathlib import Path

from quote_time import tick_timestamp
from time_basis import TimeBasis

CONFIG_PATH = Path(__file__).with_name("paper_time_config.json")


class StaleQuoteError(ValueError):
    def __init__(self, symbol, age):
        self.symbol, self.age = symbol, age
        super().__init__(f"{symbol} trop ancien : age apres normalisation {age:.3f} s (limite 15 s). En attente de cotations fraiches.")




def utc_bound(value):
    bound = datetime.fromisoformat(value)
    if bound.tzinfo is None or bound.utcoffset().total_seconds() != 0:
        raise ValueError("Les bornes de convention PAPER doivent etre explicites en UTC.")
    return bound.timestamp()


class PaperServerTimeBasis(TimeBasis):
    def __init__(self, periods):
        super().__init__()
        self.encoding = "SERVER_WALL"
        self.periods = periods

    @property
    def zone_name(self):
        return "FTMO_PAPER_CONFIGURED_PERIODS"

    def _matches(self, raw):
        return [(raw-offset, offset) for start, end, offset in self.periods
                if start <= raw-offset < end]

    def basis_for_tick(self, raw, now, symbol):
        raw = float(raw)
        if not math.isfinite(raw) or raw <= 0:
            raise ValueError("Horodatage MT5 PAPER invalide.")
        utc_age = now-raw
        if 0 <= utc_age <= 15:
            return TimeBasis()
        matches = self._matches(raw)
        if len(matches) > 1:
            raise ValueError(f"Heure serveur ambigue pour {symbol} selon les periodes configurees; conversion refusee.")
        if matches:
            normalized_age = now-matches[0][0]
            if 0 <= normalized_age <= 15:
                return self
            if normalized_age > 15:
                raise StaleQuoteError(symbol, normalized_age)
            raise ValueError(f"Tick {symbol} futur apres conversion GMT+2 : age signe={normalized_age:.3f} s.")
        if utc_age > 15:
            raise StaleQuoteError(symbol, utc_age)
        raise ValueError(f"Aucune convention PAPER valide pour {symbol} : age UTC={utc_age:.3f}s; tick futur ou date hors periode GMT+2 confirmee.")

    def normalize(self, raw, now=None):
        raw = float(raw)
        if not math.isfinite(raw) or raw <= 0:
            raise ValueError("Horodatage MT5 PAPER invalide.")
        matches = self._matches(raw)
        if len(matches) != 1:
            message = "Heure serveur ambigue" if len(matches) > 1 else "Convention FTMO PAPER non definie"
            raise ValueError(message + " pour cette date : conversion refusee. Confirmer les periodes officielles dans paper_time_config.json; aucun calendrier DST devine.")
        return matches[0][0]

    def tick(self, tick, symbol, now=None):
        timestamp = self.normalize(tick_timestamp(tick), now)
        current = time.time() if now is None else now
        age = current-timestamp
        if age > 15:
            raise StaleQuoteError(symbol, age)
        if age < 0:
            raise ValueError(f"Tick {symbol} futur apres normalisation : age signe={age:.3f} s.")
        return timestamp


def configured_paper_basis(mt5, account, now):
    if account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO:
        raise ValueError("Convention FTMO PAPER reservee au compte DEMO.")
    try:
        config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        if (config["encoding"] != "SERVER_WALL" or config["serverPrefix"] != "FTMO-Demo"
                or set(config["symbols"]) != {"XAUUSD", "EURUSD"}
                or not isinstance(config["confirmation"], str) or not config["confirmation"].strip()):
            raise ValueError("Convention FTMO PAPER incomplete ou non confirmee.")
        if not str(account.server).casefold().startswith(config["serverPrefix"].casefold()):
            raise ValueError("Convention FTMO PAPER incompatible avec le serveur connecte.")
        periods = []
        for item in config["periods"]:
            start = utc_bound(item["fromUTC"])
            end = float("inf") if item["untilUTC"] is None else utc_bound(item["untilUTC"])
            offset = item["offsetSeconds"]
            if isinstance(offset, bool) or not isinstance(offset, int) or offset not in (7200, 10800) or start >= end:
                raise ValueError("Cette configuration PAPER n'accepte que la periode FTMO GMT+2 explicitement confirmee; aucune regle DST n'est deduite.")
            periods.append((start, end, offset))
        periods.sort()
        if not periods or any(right[0] < left[1] for left, right in zip(periods, periods[1:])):
            raise ValueError("Periodes FTMO PAPER absentes ou chevauchantes.")
        return PaperServerTimeBasis(periods)
    except (OSError, KeyError, TypeError, ValueError) as error:
        raise ValueError("Configuration horaire PAPER refusee : " + str(error)) from error
