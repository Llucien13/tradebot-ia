"""V86 read-only metrics over recorded PAPER transactions; no market access."""
import hashlib
import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

INITIAL = 20000.
PARIS = ZoneInfo("Europe/Paris")


def trade_id(trade):
    identity = [trade.get(key) for key in ("phase", "signalTime", "entryTime", "side")]
    return "P-" + hashlib.sha256(json.dumps(identity, separators=(",", ":")).encode()).hexdigest()[:20]


def metrics(state, now):
    trades = sorted(state.get("trades", []), key=lambda t: t["exitTime"])
    values = [t["pnl"] for t in trades]
    wins, losses = [v for v in values if v > 0], [v for v in values if v < 0]
    gross_win, gross_loss = sum(wins), -sum(losses)
    ratios = [t["pnl"] / t["riskEUR"] for t in trades if t.get("riskEUR", 0) > 0]
    local = datetime.fromtimestamp(now, PARIS)
    today = local.replace(hour=0, minute=0, second=0, microsecond=0)
    bounds = {"today": today.timestamp(), "week": (today-timedelta(days=6)).timestamp(),
              "month": today.replace(day=1).timestamp()}
    periods = {name: sum(t["pnl"] for t in trades if start <= t["exitTime"] <= now)
               for name, start in bounds.items()}
    daily = {}
    for trade in trades:
        day = datetime.fromtimestamp(trade["exitTime"], PARIS).date().isoformat()
        daily[day] = daily.get(day, 0.) + trade["pnl"]
    # Recorded equity observations, not intrabar extremes or reconstructed prices.
    points = sorted(state.get("curve", []), key=lambda p: p["time"])
    peak, drawdown, drawdown_percent = INITIAL, 0., 0.
    for point in points:
        value = point["equity"]
        peak = max(peak, value)
        drawdown = max(drawdown, peak-value)
        if peak > 0:
            drawdown_percent = max(drawdown_percent, (peak-value)/peak*100)
    # Bound payload while preserving bucket extrema and their temporal order.
    chart = points
    if len(points) > 600:
        width = (len(points)+199)//200
        chart = []
        for start in range(0, len(points), width):
            group = points[start:start+width]
            selected = {p["time"]: p for p in (group[0], min(group, key=lambda p: p["equity"]),
                                               max(group, key=lambda p: p["equity"]), group[-1])}
            chart.extend(selected[k] for k in sorted(selected))
    return {"initial": INITIAL, "balance": state["balance"], "realized": sum(values),
            "periods": {**periods, "total": sum(values)}, "count": len(values),
            "wins": len(wins), "losses": len(losses), "neutral": len(values)-len(wins)-len(losses),
            "winRate": len(wins)/len(values)*100 if values else None,
            "averageWin": gross_win/len(wins) if wins else None,
            "averageLoss": sum(losses)/len(losses) if losses else None,
            "profitFactor": gross_win/gross_loss if gross_loss else None,
            "profitFactorInfinite": gross_win > 0 and gross_loss == 0,
            "averageEUR": sum(values)/len(values) if values else None,
            "averageR": sum(ratios)/len(ratios) if ratios else None, "rCount": len(ratios),
            "drawdownEUR": drawdown if points else None,
            "drawdownPercent": drawdown_percent if points else None,
            "curve": [{"time": p["time"], "equity": p["equity"]} for p in chart],
            "curveSamples": len(points), "daily": [{"day": day, "pnl": pnl} for day, pnl in sorted(daily.items())]}
