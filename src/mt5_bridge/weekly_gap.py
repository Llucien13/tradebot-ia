"""PAPER weekly gap policy. No inferred session hours, MT5 calls or timezone offsets."""
import hashlib
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit


class ScheduleError(ValueError):
    pass


def utc(value):
    if not isinstance(value, str) or not value.endswith(("Z", "+00:00")):
        raise ScheduleError("Date UTC explicite requise")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ScheduleError("Date UTC invalide") from error
    if parsed.tzinfo is None or parsed.utcoffset().total_seconds() != 0:
        raise ScheduleError("Dates de calendrier obligatoirement en UTC")
    return parsed.timestamp()


def schedule_path():
    configured = os.environ.get("TRADEBOT_PAPER_MARKET_SCHEDULE")
    if configured:
        return Path(configured)
    return Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "TradeBotIA" / "essai-paper20k" / "verified-weekly-market.json"


def read_schedule(path, now, identity):
    if path.stat().st_size > 65536:
        raise ScheduleError("Calendrier trop volumineux")
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if data.get("schemaVersion") != 1 or data.get("symbol") != "XAUUSD":
        raise ScheduleError("Calendrier XAUUSD version 1 requis")
    if not isinstance(data.get("server"), str) or not data["server"].strip() or not isinstance(data.get("login"), (str, int)) or isinstance(data.get("login"), bool) or not str(data["login"]).strip():
        raise ScheduleError("Identite serveur/login du calendrier invalide")
    if not isinstance(identity, dict) or any(not str(identity.get(k, "")).strip() for k in ("server", "login")):
        raise ScheduleError("Identite actuelle du compte MT5 indisponible")
    if any(str(data.get(k, "")) != str(identity.get(k, "")) for k in ("server", "login")):
        raise ScheduleError("Compte/serveur du calendrier non verifies")
    verified, expires = utc(data["verifiedAtUTC"]), utc(data["expiresAtUTC"])
    if not verified <= now < expires or not 0 < expires-verified <= 8*86400:
        raise ScheduleError("Attestation expiree, future ou validite superieure a 8 jours")
    proof = data["evidence"]
    if not isinstance(proof, dict) or not isinstance(proof.get("sourceURL"), str) or not isinstance(proof.get("file"), str) or not isinstance(proof.get("sha256"), str):
        raise ScheduleError("Preuve documentaire mal formee")
    url = urlsplit(proof["sourceURL"])
    if (url.scheme != "https" or url.hostname not in ("ftmo.com", "www.ftmo.com") or url.port not in (None, 443) or url.username or url.password
            or not isinstance(proof.get("verifiedBy"), str) or not proof["verifiedBy"].strip()
            or proof.get("exceptionsChecked") is not True
            or proof.get("utcAndDSTChecked") is not True):
        raise ScheduleError("Source officielle FTMO et verification exceptions/UTC/DST requises")
    artifact = Path(proof["file"])
    if not artifact.is_absolute():
        artifact = path.parent / artifact
    if not 0 < artifact.stat().st_size <= 20*1024*1024:
        raise ScheduleError("Preuve horaire absente ou trop volumineuse")
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    if digest != proof["sha256"]:
        raise ScheduleError("Empreinte du document horaire differente")
    if not isinstance(data.get("sessions"), list):
        raise ScheduleError("Liste des sessions du calendrier requise")
    sessions = []
    for item in data["sessions"]:
        opened, closed, reopened = (utc(item[k]) for k in ("openUTC", "weeklyCloseUTC", "reopenUTC"))
        if not verified-8*86400 <= opened < closed < reopened <= expires or reopened-opened > 8*86400:
            raise ScheduleError("Fenetre ouverte/fermeture/reouverture hors attestation")
        sessions.append((opened, closed, reopened))
    if not 1 <= len(sessions) <= 16:
        raise ScheduleError("Sessions attestees absentes ou trop nombreuses")
    sessions.sort()
    if any(b[0] < a[2] for a, b in zip(sessions, sessions[1:])):
        raise ScheduleError("Fenêtres horaires chevauchantes")
    if not isinstance(data.get("exceptions"), list):
        raise ScheduleError("Liste explicite des fermetures exceptionnelles requise, meme si vide")
    exceptions = []
    for item in data["exceptions"]:
        closed, reopened = utc(item["closedFromUTC"]), utc(item["closedUntilUTC"])
        if not verified <= closed < reopened <= expires:
            raise ScheduleError("Fermeture exceptionnelle hors attestation")
        exceptions.append((closed, reopened))
    if len(exceptions) > 64:
        raise ScheduleError("Trop de fermetures exceptionnelles")
    exceptions.sort()
    if any(b[0] < a[1] for a, b in zip(exceptions, exceptions[1:])):
        raise ScheduleError("Fermetures exceptionnelles chevauchantes")
    if any(not any(opened <= start < closed and end <= reopened for opened, closed, reopened in sessions)
           for start, end in exceptions):
        raise ScheduleError("Fermeture exceptionnelle non couverte par une session attestee")
    return sessions, exceptions, digest, expires, proof["sourceURL"]


def market_protection(now, identity=None, path=None):
    base = {"checkedAt": now, "entriesAllowed": False, "closeDue": False,
            "weeklyClose": None, "reopen": None, "expiresAt": None, "evidenceSha256": None,
            "sourceURL": None, "marketOpen": None, "status": "UNKNOWN", "reason": ""}
    try:
        if not isinstance(now, (int, float)) or not math.isfinite(now):
            raise ScheduleError("Horloge invalide")
        sessions, exceptions, digest, expires, source = read_schedule(schedule_path() if path is None else Path(path), now, identity)
        exceptional = next(((start, end) for start, end in exceptions if start <= now < end), None)
        if exceptional:
            return {**base, "weeklyClose": exceptional[0], "reopen": exceptional[1], "expiresAt": expires,
                    "evidenceSha256": digest, "sourceURL": source, "marketOpen": False,
                    "status": "MARKET_CLOSED", "reason": "Fermeture exceptionnelle attestee; aucune execution PAPER pendant la fermeture."}
        current = next((s for s in sessions if s[0] <= now < s[2]), None)
        if current is None:
            future = next((s for s in sessions if now < s[0]), None)
            if future and any(not (end <= future[0] or start >= future[2]) for start, end in exceptions):
                raise ScheduleError("Calendrier exceptionnel a renouveler : session courante ambigue")
            raise ScheduleError("Instant courant non couvert par une session attestee")
        opened, closed, reopened = current
        exceptional_close = next(((start, end) for start, end in exceptions if opened <= now < start < closed), None)
        if exceptional_close and any(a[2] <= exceptional_close[1] and b[0] < exceptional_close[1] for a, b in zip(sessions, sessions[1:])):
            raise ScheduleError("Fermeture exceptionnelle chevauche une session suivante")
        deadline, deadline_reopen = exceptional_close if exceptional_close else (closed, reopened)
        remaining = deadline-now
        is_open = now < deadline
        status = "MARKET_CLOSED" if not is_open else "EXIT_DUE" if remaining <= 900 else "ENTRY_BLOCKED" if remaining <= 3600 else "OPEN"
        return {**base, "entriesAllowed": is_open and remaining > 3600, "closeDue": is_open and remaining <= 900,
                "weeklyClose": deadline, "reopen": deadline_reopen, "expiresAt": expires,
                "evidenceSha256": digest, "sourceURL": source, "marketOpen": is_open, "status": status,
                "reason": {"OPEN": "Hors fenetres anti-gap, selon attestation locale.",
                           "ENTRY_BLOCKED": "Dernieres 60 minutes avant fermeture attestee : nouvelles entrees PAPER interdites.",
                           "EXIT_DUE": "Dernieres 15 minutes avant fermeture attestee : sortie preventive PAPER requise.",
                           "MARKET_CLOSED": "Fermeture attestee atteinte : aucune execution simulee sur un ancien tick."}[status]}
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
        return {**base, "reason": "Horaires non verifies : " + (str(error) if isinstance(error, ScheduleError) else "calendrier ou preuve absent/invalide") + ". Nouvelles entrees PAPER bloquees."}
