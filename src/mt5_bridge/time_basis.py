"""Fail-closed normalization of live FTMO data; archived data is never rewritten."""
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from quote_time import tick_timestamp
from server_clock import confirmed_server_clock

MISSING_PROOF = ("Preuve manquante : releve natif FTMO-Demo simultane, avec la convention "
                 "ticks/bougies et la regle de changement d'heure FTMO confirmee. "
                 "Aucun decalage n'est deduit de l'age du tick.")


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ValueError("Horodatage de preuve invalide.")
    return float(value)


class TimeBasis:
    def __init__(self, encoding="UTC", zone=None, valid_until=None):
        if encoding not in {"UTC", "SERVER_WALL"} or (encoding == "SERVER_WALL" and zone is None):
            raise ValueError("Convention temporelle non demontree.")
        self.encoding, self.zone, self.valid_until = encoding, zone, valid_until
        self.server_clock = None
        self.capture_gmt = None
        self.native_raw = None
        self.native_normalized = None

    @property
    def zone_name(self):
        return getattr(self.zone, "key", str(self.zone)) if self.zone else None

    def normalize(self, raw, now=None):
        raw = number(raw)
        now = time.time() if now is None else now
        if self.valid_until is not None and now > self.valid_until:
            raise ValueError("Releve natif expire. " + MISSING_PROOF)
        if self.encoding == "UTC":
            return raw
        wall = datetime.fromtimestamp(raw, timezone.utc).replace(tzinfo=None)
        candidates = set()
        for fold in (0, 1):
            stamp = wall.replace(tzinfo=self.zone, fold=fold).timestamp()
            if datetime.fromtimestamp(stamp, self.zone).replace(tzinfo=None) == wall:
                candidates.add(stamp)
        if len(candidates) != 1:
            raise ValueError("Heure serveur ambigue ou inexistante au changement d'heure : lecture refusee.")
        normalized = candidates.pop()
        if self.server_clock:
            self.server_clock.offset(normalized)
        return normalized

    def tick(self, tick, symbol, now=None):
        now = time.time() if now is None else now
        timestamp = self.normalize(tick_timestamp(tick), now)
        age = now - timestamp
        if age > 15 or age < 0:
            raise ValueError(f"Tick {symbol} ancien ou futur apres normalisation : age signe={age:.3f} s. Anciennete maximale 15 s ; aucun tick futur accepte.")
        return timestamp

    def tick_against_capture(self, tick, symbol, now=None):
        now = time.time() if now is None else now
        raw = tick_timestamp(tick)
        timestamp = self.normalize(raw, now)
        age = now-timestamp
        if age < 0:
            native_age = None if self.native_normalized is None else self.capture_gmt-self.native_normalized
            same_capture = self.native_raw is not None and abs(raw-self.native_raw) <= .001
            if not same_capture or native_age is None or not -1.0 <= native_age <= 15 or age < -.5:
                raise ValueError(f"Tick {symbol} futur apres normalisation : age signe={age:.3f} s, preuve native={native_age!r} s. Attente maximale 0,5 s seulement pour le tick identique au releve.")
            # Absorb subsecond capture skew by waiting, never by changing a tick or
            # widening the final freshness window. Recheck even if the clock steps back.
            time.sleep(-age + .002)
            now = time.time()
        return self.tick(tick, symbol, now)

    def bars(self, raw_times, now=None):
        now = time.time() if now is None else now
        stamps = [self.normalize(float(raw), now) for raw in raw_times]
        if any(stamp > now for stamp in stamps):
            raise ValueError("Bougie future apres normalisation : lecture refusee.")
        if any(right <= left for left, right in zip(stamps, stamps[1:])):
            raise ValueError("Bougies non strictement chronologiques apres normalisation.")
        return stamps


def _read_native_proof(terminal):
    path = Path(terminal.data_path) / "MQL5" / "Files" / "tradebot-clock-proof.json"
    try:
        if path.stat().st_size > 65536:
            raise ValueError("Releve natif trop volumineux.")
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as error:
        raise ValueError(MISSING_PROOF) from error


def load_time_basis(mt5, terminal, account, now=None):
    """Validate a native observation, not a correction guessed from a quote's age."""
    now = time.time() if now is None else now
    if account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO or not str(account.server).casefold().startswith("ftmo-demo"):
        raise ValueError("Normalisation reservee au compte DEMO FTMO-Demo.")
    proof = _read_native_proof(terminal)
    return validate_time_basis(proof, mt5, account, now)


def load_trial_time_bases(mt5, terminal, account, now=None):
    """Validate each PAPER symbol against the independent native clocks and bars."""
    now = time.time() if now is None else now
    if account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO or not str(account.server).casefold().startswith("ftmo-demo"):
        raise ValueError("Normalisation reservee au compte DEMO FTMO-Demo.")
    proof = _read_native_proof(terminal)
    if not isinstance(proof, dict) or proof.get("schemaVersion") != 2 or proof.get("tester") is not False:
        raise ValueError(MISSING_PROOF)
    if proof.get("server") != account.server or str(proof.get("login")) != str(account.login):
        raise ValueError("Preuve native d'un autre compte/serveur refusee.")
    gmt = number(proof.get("timeGMT"))
    if not 0 <= now - gmt <= 120:
        raise ValueError("Releve natif futur ou expire (>120 s). " + MISSING_PROOF)
    server_time = number(proof.get("timeTradeServer"))
    current_time = number(proof.get("timeCurrent"))
    if abs(current_time-server_time) > 5:
        raise ValueError("Horloges serveur natives non synchronisees.")
    ticks = proof.get("ticks")
    if not isinstance(ticks, list):
        raise ValueError("Ticks natifs absents. " + MISSING_PROOF)

    bases = {}
    for symbol in ("XAUUSD", "EURUSD"):
        matches = [entry for entry in ticks if isinstance(entry, dict) and entry.get("symbol") == symbol]
        if len(matches) != 1:
            raise ValueError(f"Releve natif {symbol} absent ou duplique.")
        native = matches[0]
        raw = tick_timestamp(SimpleNamespace(time=native.get("time"), time_msc=native.get("time_msc")))
        native_bar_raw = number(native.get("m15Open"))
        utc_age, server_age = gmt-raw, current_time-raw
        # Native datetime timestamps quantize the capture to whole seconds. Permit up to 1 s
        # only when identifying that capture's clock; live quote freshness stays strict.
        utc_match = -1.0 <= utc_age <= 15
        server_match = -1.0 <= server_age <= 15
        if utc_match == server_match:
            raise ValueError(f"Convention horaire native indecidable pour {symbol} : age GMT={utc_age:.3f}s, age serveur={server_age:.3f}s.")
        encoding = "UTC" if utc_match else "SERVER_WALL"
        if proof.get("encoding") not in ("AUTO", encoding):
            raise ValueError(f"Convention declaree contredite par les horloges natives pour {symbol}.")
        clock = confirmed_server_clock(proof, gmt) if encoding == "SERVER_WALL" else None
        basis = TimeBasis(encoding, clock.zone if clock else None, gmt+120)
        basis.server_clock = clock
        basis.capture_gmt = gmt
        normalized_native = basis.normalize(raw, now)
        if not -1.0 <= gmt-normalized_native <= 15:
            raise ValueError(f"Tick natif {symbol} hors de la fenetre de capture.")
        basis.native_raw = raw
        basis.native_normalized = normalized_native
        if abs(native_bar_raw-int(raw//900)*900) > 1:
            raise ValueError(f"Bougie native M15 {symbol} incoherente avec son tick.")
        normalized_native_bar = basis.normalize(native_bar_raw, now)
        if abs(normalized_native_bar-int(normalized_native//900)*900) > 1:
            raise ValueError(f"Tick et bougie native M15 {symbol} divergents apres normalisation.")
        if not mt5.symbol_select(symbol, True):
            raise ValueError(f"Symbole {symbol} indisponible pour la verification temporelle.")
        python_tick = mt5.symbol_info_tick(symbol)
        read_at = time.time()
        if python_tick is None:
            raise ValueError(f"Tick Python {symbol} indisponible.")
        python_raw = tick_timestamp(python_tick)
        if python_raw + .001 < raw:
            raise ValueError(f"Tick Python {symbol} anterieur au releve natif : preuve incoherente.")
        python_normalized = basis.tick_against_capture(python_tick, symbol, read_at)
        read_at = time.time()
        rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M15, 0, 1)
        if rates is None or len(rates) != 1:
            raise ValueError(f"Bougie Python M15 {symbol} indisponible.")
        python_bar = number(float(rates[0]["time"]))
        normalized_python_bar = basis.bars([python_bar], read_at)[0]
        if abs(normalized_python_bar-int(python_normalized//900)*900) > 1:
            raise ValueError(f"Tick et bougie Python M15 {symbol} divergents apres normalisation.")
        # A capture can precede the next M15 boundary within its 120 s lifetime.
        expected_advance = (int(python_normalized//900)-int(normalized_native//900))*900
        if expected_advance not in (0, 900) or abs(normalized_python_bar-normalized_native_bar-expected_advance) > 1:
            raise ValueError(f"Bougies natives et Python M15 {symbol} non synchronisees apres normalisation.")
        bases[symbol] = basis
    return bases


def validate_time_basis(proof, mt5, account, now):
    if not isinstance(proof, dict) or proof.get("schemaVersion") != 2 or proof.get("tester") is not False:
        raise ValueError(MISSING_PROOF)
    if proof.get("server") != account.server or str(proof.get("login")) != str(account.login):
        raise ValueError("Preuve native d'un autre compte/serveur refusee.")
    gmt = number(proof.get("timeGMT"))
    if not 0 <= now - gmt <= 120:
        raise ValueError("Releve natif futur ou expire (>120 s). " + MISSING_PROOF)
    server_time = number(proof.get("timeTradeServer"))
    current_time = number(proof.get("timeCurrent"))
    if abs(current_time - server_time) > 5:
        raise ValueError("Horloges serveur natives non synchronisees ; marche ferme ou releve incoherent.")
    encoding = proof.get("encoding")
    if encoding == "AUTO":
        readings = proof.get("ticks")
        if not isinstance(readings, list) or len(readings) != 2 or any(not isinstance(entry, dict) for entry in readings):
            raise ValueError("Deux ticks natifs XAUUSD/EURUSD requis pour identifier la convention.")
        stamps = [tick_timestamp(SimpleNamespace(time=entry.get("time"), time_msc=entry.get("time_msc"))) for entry in readings]
        utc_matches = all(-5 <= gmt-raw <= 15 for raw in stamps)
        server_matches = all(-5 <= current_time-raw <= 15 for raw in stamps)
        if utc_matches and not server_matches:
            encoding = "UTC"
        elif server_matches and not utc_matches:
            encoding = "SERVER_WALL"
        else:
            raise ValueError("Convention indecidable entre les horloges GMT et serveur natives. " + MISSING_PROOF)
    if encoding not in {"UTC", "SERVER_WALL"}:
        raise ValueError("Convention ticks/bougies non confirmee. " + MISSING_PROOF)
    server_clock = confirmed_server_clock(proof, gmt)
    basis = TimeBasis(encoding, server_clock.zone if encoding == "SERVER_WALL" else None, gmt+120)
    basis.server_clock = server_clock
    ticks = proof.get("ticks")
    if not isinstance(ticks, list):
        raise ValueError("Ticks natifs absents. " + MISSING_PROOF)
    for symbol in ("XAUUSD", "EURUSD"):
        matches = [entry for entry in ticks if isinstance(entry, dict) and entry.get("symbol") == symbol]
        if len(matches) != 1:
            raise ValueError("Releve natif XAUUSD/EURUSD incomplet.")
        native = matches[0]
        native_raw = tick_timestamp(SimpleNamespace(time=native.get("time"), time_msc=native.get("time_msc")))
        native_utc = basis.normalize(native_raw, now)
        if not -5 <= gmt - native_utc <= 15:
            raise ValueError("Le tick natif contredit la convention temporelle declaree.")
        if encoding == "SERVER_WALL" and abs(native_raw - current_time) > 15:
            raise ValueError("Le tick natif ne correspond pas a l'horloge serveur.")
        if not mt5.symbol_select(symbol, True):
            raise ValueError(f"Symbole {symbol} indisponible pour la verification temporelle.")
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            raise ValueError(f"Tick Python {symbol} indisponible.")
        basis.tick(tick, symbol, now)
        if tick_timestamp(tick) + .001 < native_raw:
            raise ValueError("Tick Python anterieur au releve natif : preuve incoherente.")
        native_bar = number(native.get("m15Open"))
        if abs(native_bar - int(native_raw // 900)*900) > 1:
            raise ValueError("Bougie native M15 incoherente avec son tick.")
        rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M15, 0, 1)
        if rates is None or len(rates) != 1:
            raise ValueError("Bougie Python M15 indisponible pour verification.")
        python_bar = number(float(rates[0]["time"]))
        if abs(python_bar - int(tick_timestamp(tick)//900)*900) > 1:
            raise ValueError("Ticks et bougies Python n'utilisent pas la meme base temporelle.")
        opening = basis.bars([python_bar], now)[0]
        if abs(opening - int(basis.tick(tick, symbol, now)//900)*900) > 1:
            raise ValueError("Bougie et tick non synchronises apres normalisation.")
    return basis
