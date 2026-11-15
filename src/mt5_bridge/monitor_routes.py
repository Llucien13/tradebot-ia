"""Local-only V86 observation API; no engine controls or execution endpoints."""
import csv
import io
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict


class NotificationOptions(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    enabled: bool
    open: bool
    close: bool
    safe: bool
    recovery: bool


def register_monitor_routes(app, getter):
    def service():
        monitor = getter()
        if monitor is None:
            raise HTTPException(503, "Monitoring V86 indisponible. Le moteur PAPER reste independant.")
        return monitor

    @app.get("/paper-monitor/state")
    def monitor_state():
        return service().snapshot()

    @app.get("/paper-monitor/journal")
    def journal(start: float = Query(0, ge=0), end: float = Query(4102444800, ge=0, le=4102444800),
                result: str = Query("all", pattern="^(all|win|loss|neutral|open)$"),
                offset: int = Query(0, ge=0, le=1000000), limit: int = Query(30, ge=1, le=100)):
        return service().store.journal(start, end, result, offset, limit)

    @app.get("/paper-monitor/export.csv")
    def export(start: float = Query(0, ge=0), end: float = Query(4102444800, ge=0, le=4102444800),
               result: str = Query("all", pattern="^(all|win|loss|neutral|open)$")):
        data = service().store.journal(start, end, result, 0, 10000)
        if data["total"] > 10000:
            raise HTTPException(413, "Export limite a 10000 trades : reduire la periode")
        output = io.StringIO(newline="")
        writer = csv.writer(output, delimiter=";")
        writer.writerow(["ID", "Instrument", "Sens", "Entree UTC", "Entree Europe/Paris", "Sortie UTC", "Etat",
                         "Entree", "Sortie", "SL", "TP", "Lots", "Risque EUR", "PnL EUR", "% capital initial", "R", "Motif entree", "Motif sortie"])
        def date(value, zone=timezone.utc):
            return datetime.fromtimestamp(value, zone).isoformat() if value is not None else ""
        def safe(value):
            if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
                return "'"+value
            return value
        for item in data["items"]:
            t = item["trade"]
            pnl, risk = t.get("pnl"), t.get("riskEUR", 0)
            row = [item["id"], "XAUUSD", "ACHAT" if t["side"] == 1 else "VENTE", date(t["entryTime"]),
                   date(t["entryTime"], ZoneInfo("Europe/Paris")), date(t.get("exitTime")),
                   "CLOTURE" if "exitTime" in t else "A VERIFIER" if item["needsReview"] else "OUVERT",
                   t["entry"], t.get("exit", ""), t["sl"], t["tp"], t["lots"], risk, pnl if pnl is not None else "",
                   pnl/200 if pnl is not None else "", pnl/risk if pnl is not None and risk > 0 else "",
                   t.get("entryReason", "Non enregistre"), t.get("reason", "")]
            writer.writerow([safe(v) for v in row])
        return Response("\ufeff"+output.getvalue(), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": 'attachment; filename="tradebot-paper-v86.csv"'})

    @app.post("/paper-monitor/notifications/settings")
    def notification_settings(options: NotificationOptions):
        return service().store.configure(options.model_dump())

    @app.post("/paper-monitor/notifications/test")
    def notification_test():
        try:
            return service().test_notification()
        except ValueError as error:
            raise HTTPException(409, str(error)) from error
