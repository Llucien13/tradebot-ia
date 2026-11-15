"""FTMO server calendar, independent from the Europe/Prague loss day."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

SOURCES = ["https://ftmo.com/fr/trading-updates/",
           "https://ftmo.com/fr/faq/quelles-sont-les-specifications-du-compte/"]
# User-confirmed period only. No spring/autumn transition is guessed from Prague.
WINTER_START = datetime(2026, 11, 1, 22, tzinfo=timezone.utc).timestamp()
WINTER_END = datetime(2026, 12, 31, 22, tzinfo=timezone.utc).timestamp()


class ServerClock:
    def __init__(self, zone, source, window=None):
        self.zone, self.source, self.window = zone, source, window
        self.name = getattr(zone, "key", str(zone))

    def offset(self, timestamp):
        if self.window and not self.window[0] <= timestamp < self.window[1]:
            raise ValueError("Calendrier annuel FTMO incomplet pour cette date : dates/regle des transitions officielles requises. Aucun calendrier Prague substitue.")
        return int(datetime.fromtimestamp(timestamp, timezone.utc).astimezone(self.zone).utcoffset().total_seconds())

    def last_midnight(self, timestamp):
        self.offset(timestamp)
        local = datetime.fromtimestamp(timestamp, self.zone)
        cutoff = local.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        self.offset(cutoff)
        return cutoff

    def rollovers(self, after, until):
        self.offset(after)
        self.offset(until)
        day = datetime.fromtimestamp(after, self.zone).date()
        last = datetime.fromtimestamp(until, self.zone).date()
        while day <= last:
            wall = datetime.combine(day, datetime.min.time())
            candidates = set()
            for fold in (0, 1):
                stamp = wall.replace(tzinfo=self.zone, fold=fold).timestamp()
                if datetime.fromtimestamp(stamp, self.zone).replace(tzinfo=None) == wall:
                    candidates.add(stamp)
            if len(candidates) != 1:
                raise ValueError("Minuit serveur ambigu/inexistant : swaps bloques.")
            cutoff = candidates.pop()
            if after < cutoff <= until:
                self.offset(cutoff)
                # Rollover at the end of the previous server trading day.
                trading_day = day - timedelta(days=1)
                yield cutoff, trading_day.weekday()
            day += timedelta(days=1)


def confirmed_server_clock(proof, now):
    observed = proof["timeTradeServer"] - proof["timeGMT"]
    if WINTER_START <= now < WINTER_END and abs(observed - 7200) > 2:
        raise ValueError("Horloge native MT5 contraire au GMT+2 FTMO confirme depuis le 02/11/2026.")
    policy = proof.get("confirmedPolicy")
    if isinstance(policy, dict) and policy.get("confirmed") is True and isinstance(policy.get("source"), str) and policy["source"].strip() and policy.get("ianaZone"):
        try:
            clock = ServerClock(ZoneInfo(policy["ianaZone"]), policy["source"])
        except (KeyError, ValueError, TypeError) as error:
            raise ValueError("Fuseau annuel declare inconnu; aucun remplacement.") from error
        if abs(clock.offset(now) - observed) > 2:
            raise ValueError("La regle DST declaree contredit les horloges natives FTMO.")
        return clock
    if WINTER_START <= now < WINTER_END:
        return ServerClock(timezone(timedelta(hours=2), "FTMO_GMT_PLUS_2_CONFIRMED_2026"), SOURCES,
                           (WINTER_START, WINTER_END))
    raise ValueError("Regle annuelle FTMO manquante pour cette date. GMT+2/GMT+3 et une seule date ne prouvent pas les transitions annuelles; aucun fuseau devine.")
