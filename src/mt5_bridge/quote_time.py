"""MT5 Unix timestamps: no local-time or broker-offset correction."""
import math
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

PARIS = ZoneInfo("Europe/Paris")


def tick_timestamp(tick):
    seconds = float(tick.time)
    milliseconds = float(tick.time_msc or 0)
    if not math.isfinite(seconds) or seconds <= 0 or not math.isfinite(milliseconds) or milliseconds < 0:
        raise ValueError("Horodatage MT5 invalide : time/time_msc doivent etre des timestamps Unix positifs.")
    if milliseconds:
        if int(milliseconds // 1000) != int(seconds):
            raise ValueError(f"Horodatages MT5 incoherents : time={tick.time} s, time_msc={tick.time_msc} ms. Lecture refusee ; aucune correction horaire automatique.")
        return milliseconds / 1000
    return seconds


def clock_details(timestamp, now):
    tick_utc = datetime.fromtimestamp(timestamp, timezone.utc)
    now_utc = datetime.fromtimestamp(now, timezone.utc)
    return (f"tick UTC={tick_utc.isoformat(timespec='milliseconds')}, "
            f"tick Europe/Paris={tick_utc.astimezone(PARIS).isoformat(timespec='milliseconds')}, "
            f"passerelle UTC={now_utc.isoformat(timespec='milliseconds')}, "
            f"passerelle Europe/Paris={now_utc.astimezone(PARIS).isoformat(timespec='milliseconds')}, "
            f"age signe={now - timestamp:.3f} s")


def fresh_tick_timestamp(tick, symbol, now=None):
    timestamp = tick_timestamp(tick)
    now = time.time() if now is None else now
    age = now - timestamp
    if age > 15 or age < -5:
        reason = "ancien" if age > 15 else "dans le futur"
        raise ValueError(
            f"Tick {symbol} {reason} : {clock_details(timestamp, now)}. "
            f"MT5 brut : time={tick.time}, time_msc={tick.time_msc}. "
            "Limites conservees : anciennete <= 15 s, avance <= 5 s. "
            "Entrees suspendues. Le fuseau d'affichage ne change pas l'age Unix. "
            "Une avance de 10800 s est compatible avec une heure serveur GMT+3, sans prouver l'encodage de l'API. "
            "Preuve manquante : releve natif simultane des horloges serveur/GMT et du tick de ce terminal FTMO-Demo. "
            "Utilisez Releve croise + autotests dans Connexion MT5. Aucune compensation deduite de l'age du tick."
        )
    return timestamp
