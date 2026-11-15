"""Optional Telegram sender. No MT5, PAPER engine or secret returned to clients."""
import json
import os
import re
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def credentials():
    token = os.environ.get("TRADEBOT_TELEGRAM_TOKEN", "").strip()
    chat = os.environ.get("TRADEBOT_TELEGRAM_CHAT_ID", "").strip()
    if not re.fullmatch(r"\d+:[A-Za-z0-9_-]{20,}", token) or not re.fullmatch(r"-?\d+", chat):
        return None
    return token, chat


def send(message):
    configured = credentials()
    if not configured:
        return "FAILED", "Variables Telegram absentes ou invalides", 0
    token, chat = configured
    request = Request("https://api.telegram.org/bot"+token+"/sendMessage",
                      data=json.dumps({"chat_id": chat, "text": "PAPER — VIRTUEL\n"+message[:3500]}).encode(),
                      headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=8) as response:
            body = json.loads(response.read(65536))
        if body.get("ok") is True:
            return "SENT", None, 0
        return "FAILED", "Telegram a refuse cet envoi", 0
    except HTTPError as error:
        if error.code == 429:
            return "PENDING", "Limite Telegram : nouvelle tentative differee", 60
        return "UNCERTAIN" if error.code >= 500 else "FAILED", f"Telegram HTTP {error.code}", 0
    except Exception:
        # Do not log exception/URL (it contains the token). Delivery may already have happened.
        return "UNCERTAIN", "Reseau Telegram : reception inconnue, pas de renvoi automatique", 0


def deliver_one(store, now=None, sender=send):
    now = time.time() if now is None else now
    with store.lock, store.db:
        options = store.settings()
        if not options["enabled"] or not credentials():
            return False
        row = store.db.execute("SELECT o.*,e.message,e.kind FROM outbox o JOIN events e ON e.id=o.id WHERE o.status='PENDING' AND o.next<=? ORDER BY o.next LIMIT 1", (now,)).fetchone()
        if not row:
            return False
        if row["kind"] != "test" and not options.get(row["kind"], False):
            store.db.execute("UPDATE outbox SET status='CANCELLED' WHERE id=?", (row["id"],))
            return False
        store.db.execute("UPDATE outbox SET status='SENDING',attempts=attempts+1 WHERE id=?", (row["id"],))
    status, error, delay = sender(row["message"])
    attempts = row["attempts"]+1
    if status == "PENDING" and attempts >= 5:
        status, error = "FAILED", "Limite de 5 tentatives atteinte"
    with store.lock, store.db:
        store.db.execute("UPDATE outbox SET status=?,error=?,next=? WHERE id=?",
                         (status, error, now+max(delay, min(3600, 30*2**attempts)), row["id"]))
    return True
