#!/usr/bin/env python3
"""Read-only local PAPER monitor relay to authenticated TradeBot IA Cloud."""

import argparse
import getpass
import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen


LOCAL_MONITOR = "http://127.0.0.1:8765"
PAGE_SIZE = 100
MAX_TRADES = 100_000
TRADE_FIELDS = (
    "entryTime", "signalTime", "entry", "side", "lots", "sl", "tp", "riskEUR",
    "exitTime", "exit", "pnl", "reason", "entryReason",
)
POSITION_FIELDS = TRADE_FIELDS + (
    "id", "instrument", "floatingEUR", "netPositionEUR", "percentInitial",
    "r", "riskPercentInitial", "needsReview",
)
METRIC_FIELDS = ("initial", "balance", "realized", "count", "wins", "losses", "neutral", "winRate")
VALID_STATUS = {"RUNNING", "WAITING_QUOTES", "WAITING_MARKET", "SAFE_STOP", "STOPPED"}


class SyncError(Exception):
    pass


class HTTPStatusError(SyncError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def https_base(value, name):
    parsed = urlsplit(value.strip())
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise SyncError(f"{name} doit être une URL HTTPS valide sans identifiant.")
    return value.strip().rstrip("/")


def local_base(value):
    parsed = urlsplit(value)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"} or parsed.port != 8765:
        raise SyncError("La source locale doit rester fixée à 127.0.0.1:8765.")
    return value.rstrip("/")


def json_request(url, method="GET", headers=None, body=None, timeout=15):
    data = None if body is None else json.dumps(body, allow_nan=False).encode("utf-8")
    request_headers = {"Accept": "application/json", **(headers or {})}
    if data is not None:
        request_headers["Content-Type"] = "application/json"
    request = Request(url, data=data, headers=request_headers, method=method)
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        message = f"HTTP {error.code}"
        try:
            payload = json.loads(error.read().decode("utf-8"))
            detail = payload.get("statusMessage") or payload.get("detail") or payload.get("message")
            if isinstance(detail, str):
                message += f" : {detail[:300]}"
        except (ValueError, UnicodeDecodeError):
            pass
        raise HTTPStatusError(error.code, message) from error
    except (URLError, TimeoutError, OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SyncError(f"Connexion ou réponse JSON indisponible : {type(error).__name__}.") from error


def finite_number(value, name, nullable=False):
    if nullable and value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise SyncError(f"Observation locale invalide : {name}.")
    return value


def cloud_snapshot(source):
    if not isinstance(source, dict) or source.get("ready") is not True:
        reason = source.get("observerError") if isinstance(source, dict) else None
        raise SyncError(str(reason or "Observateur PAPER local non prêt."))
    if source.get("version") != 86 or source.get("mode") != "PAPER" or source.get("liveEnabled") is not False or source.get("readOnly") is not True:
        raise SyncError("Source refusée : seule une observation V86 PAPER / LIVE OFF est autorisée.")
    if source.get("status") not in VALID_STATUS:
        raise SyncError("Statut PAPER local inconnu; aucune donnée envoyée.")

    metrics = source.get("metrics")
    health = source.get("health")
    worker = health.get("worker") if isinstance(health, dict) else None
    if not isinstance(metrics, dict) or not isinstance(health, dict) or not isinstance(worker, dict):
        raise SyncError("Observation PAPER locale incomplète.")
    if finite_number(metrics.get("initial"), "capital initial") != 20_000:
        raise SyncError("Capital initial local inattendu; synchronisation refusée.")
    safe_metrics = {key: metrics.get(key) for key in METRIC_FIELDS}
    for key in ("balance", "realized", "count", "wins", "losses", "neutral"):
        finite_number(safe_metrics[key], f"métrique {key}")
    finite_number(safe_metrics["winRate"], "winRate", nullable=True)

    position = source.get("position")
    safe_position = None
    if position is not None:
        if not isinstance(position, dict) or position.get("instrument") != "XAUUSD":
            raise SyncError("Position PAPER locale invalide.")
        safe_position = {key: position[key] for key in POSITION_FIELDS if key in position}
        for key in ("entryTime", "signalTime", "entry", "side", "lots", "sl", "tp", "riskEUR"):
            finite_number(safe_position.get(key), f"position {key}")
        if safe_position["side"] not in (-1, 1):
            raise SyncError("Sens de position PAPER invalide.")
        for key in ("exitTime", "exit", "pnl", "floatingEUR", "netPositionEUR", "percentInitial", "r"):
            if key in safe_position:
                finite_number(safe_position[key], f"position {key}", nullable=True)

    snapshot = {
        "version": 86,
        "mode": "PAPER",
        "liveEnabled": False,
        "readOnly": True,
        "observedAt": finite_number(source.get("observedAt"), "horodatage"),
        "fresh": source.get("fresh") is True,
        "status": source["status"],
        "floatingEUR": finite_number(source.get("floatingEUR"), "P&L latent", nullable=True),
        "position": safe_position,
        "metrics": safe_metrics,
        "health": {
            "mt5": health.get("mt5") if health.get("mt5") in {"CONNECTED", "DISCONNECTED", "UNKNOWN"} else "UNKNOWN",
            "worker": {
                "status": str(worker.get("status", "UNKNOWN"))[:80],
                "alive": worker.get("alive") is True,
                "heartbeat": finite_number(worker.get("heartbeat"), "heartbeat", nullable=True),
            },
            "storageFault": health.get("storageFault") is not None,
        },
    }
    return snapshot


class SupabaseSession:
    def __init__(self, base_url, anon_key, email, password):
        self.base_url = https_base(base_url, "SUPABASE_URL")
        self.anon_key = anon_key.strip()
        if not self.anon_key or len(self.anon_key) > 4096:
            raise SyncError("SUPABASE_ANON_KEY absent ou invalide.")
        self.session = self._auth("token?grant_type=password", {"email": email, "password": password})

    def _auth(self, path, body):
        result = json_request(
            f"{self.base_url}/auth/v1/{path}",
            method="POST",
            headers={"apikey": self.anon_key},
            body=body,
        )
        if not isinstance(result, dict) or not isinstance(result.get("access_token"), str) or not isinstance(result.get("refresh_token"), str):
            raise SyncError("Réponse d’authentification Supabase invalide.")
        result["expires_at_local"] = time.time() + float(result.get("expires_in", 3600))
        return result

    def access_token(self, force_refresh=False):
        if force_refresh or self.session["expires_at_local"] <= time.time() + 60:
            self.session = self._auth("token?grant_type=refresh_token", {"refresh_token": self.session["refresh_token"]})
        return self.session["access_token"]

    def headers(self, force_refresh=False):
        return {
            "apikey": self.anon_key,
            "Authorization": f"Bearer {self.access_token(force_refresh)}",
        }


class PaperCloudSync:
    def __init__(self, cloud_url, auth, local_url=LOCAL_MONITOR):
        self.cloud_url = https_base(cloud_url, "TRADEBOT_CLOUD_URL")
        self.auth = auth
        self.local_url = local_base(local_url)

    def local_get(self, path):
        return json_request(f"{self.local_url}/paper-monitor/{path}", timeout=10)

    def cloud_post(self, payload):
        url = f"{self.cloud_url}/api/paper-monitor/sync"
        try:
            return json_request(url, method="POST", headers=self.auth.headers(), body=payload, timeout=20)
        except HTTPStatusError as error:
            if error.status != 401:
                raise
            return json_request(url, method="POST", headers=self.auth.headers(force_refresh=True), body=payload, timeout=20)

    def sync_once(self, full=True):
        snapshot = cloud_snapshot(self.local_get("state"))
        first_page = self.local_get("journal?" + urlencode({"start": 0, "limit": PAGE_SIZE, "offset": 0}))
        if not isinstance(first_page, dict) or not isinstance(first_page.get("items"), list):
            raise SyncError("Réponse du journal local invalide.")
        total = first_page.get("total")
        if isinstance(total, bool) or not isinstance(total, int) or not 0 <= total <= MAX_TRADES:
            raise SyncError("Taille du journal local invalide ou supérieure à la limite de sécurité.")

        offsets = range(0, total, PAGE_SIZE) if full else (0,)
        sent = 0
        for offset in offsets:
            page = first_page if offset == 0 else self.local_get(
                "journal?" + urlencode({"start": 0, "limit": PAGE_SIZE, "offset": offset})
            )
            if page.get("total") != total or page.get("offset") != offset or not isinstance(page.get("items"), list):
                raise SyncError("Le journal local a changé pendant sa lecture; le prochain cycle réessaiera.")
            body = {
                "snapshot": snapshot,
                "journal": {"total": total, "offset": offset, "items": page["items"]},
            }
            self.cloud_post(body)
            sent += len(page["items"])

        if total == 0:
            self.cloud_post({"snapshot": snapshot, "journal": {"total": 0, "offset": 0, "items": []}})
        return snapshot, sent, total


def main():
    parser = argparse.ArgumentParser(description="Relais HTTPS en lecture seule du monitoring PAPER local.")
    parser.add_argument("--interval", type=int, default=15, help="Intervalle de synchronisation en secondes (minimum 5).")
    parser.add_argument("--once", action="store_true", help="Effectue une synchronisation puis quitte.")
    parser.add_argument("--dry-run", action="store_true", help="Lit l’observateur local sans authentification ni envoi Cloud.")
    parser.add_argument("--bridge-url", default=LOCAL_MONITOR, help="URL locale; seule l’adresse loopback 127.0.0.1:8765 est acceptée.")
    args = parser.parse_args()
    if args.interval < 5:
        parser.error("--interval doit être au moins égal à 5 secondes.")

    local_url = local_base(args.bridge_url)
    sync = None
    if not args.dry_run:
        cloud_url = os.environ.get("TRADEBOT_CLOUD_URL", "")
        supabase_url = os.environ.get("SUPABASE_URL", "")
        anon_key = os.environ.get("SUPABASE_ANON_KEY", "")
        if not cloud_url or not supabase_url or not anon_key:
            raise SyncError("Définir TRADEBOT_CLOUD_URL, SUPABASE_URL et SUPABASE_ANON_KEY avant le lancement.")
        email = input("E-mail du compte Cloud autorisé : ").strip()
        password = getpass.getpass("Mot de passe Supabase (non enregistré) : ")
        if not email or not password:
            raise SyncError("Adresse e-mail et mot de passe requis.")
        sync = PaperCloudSync(cloud_url, SupabaseSession(supabase_url, anon_key, email, password), local_url)

    full_sync_done = False
    while True:
        try:
            if args.dry_run:
                snapshot = cloud_snapshot(json_request(f"{local_url}/paper-monitor/state", timeout=10))
                journal = json_request(
                    f"{local_url}/paper-monitor/journal?" + urlencode({"start": 0, "limit": 1, "offset": 0}),
                    timeout=10,
                )
                print(
                    "Lecture locale validée : PAPER/LIVE OFF, état "
                    f"{snapshot['status']}, {journal.get('total', 'inconnu')} transaction(s). "
                    "Aucune donnée envoyée."
                )
                return 0
            snapshot, sent, total = sync.sync_once(full=not full_sync_done)
            full_sync_done = True
            observed = datetime.fromtimestamp(snapshot["observedAt"], timezone.utc).isoformat()
            print(f"Synchronisation Cloud réussie : {sent}/{total} transaction(s), observation source {observed}.")
        except (SyncError, ValueError, TypeError, KeyError) as error:
            print(f"Synchronisation non confirmée : {error}", file=sys.stderr)
            if args.once:
                return 1
        if args.once:
            return 0
        time.sleep(args.interval)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nConnecteur arrêté. Aucun ordre ni contrôle moteur n’a été exécuté.")
        raise SystemExit(0)
    except SyncError as error:
        print(f"Connecteur non démarré : {error}", file=sys.stderr)
        raise SystemExit(1)
