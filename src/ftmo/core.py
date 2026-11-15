"""Independent FTMO fixed-loss PAPER ledger; no broker API."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import math

PRAGUE = ZoneInfo("Europe/Prague")
INITIAL = 20000.0
DAILY = 1000.0
TOTAL_FLOOR = 18000.0


def day_at(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).astimezone(PRAGUE).date().isoformat()


def target(phase):
    return 22000.0 if phase == 1 else 21000.0


def new_state(tp=2.5):
    return {"version": 1, "mode": "PAPER", "liveEnabled": False, "running": False,
            "tpR": tp, "phase": 1, "status": "PHASE_1", "balance": INITIAL, "equity": INITIAL,
            "day": None, "dayBase": INITIAL, "days": [], "position": None, "trades": [],
            "phases": [], "curve": [], "cashEvents": [], "peak": INITIAL, "maxDrawdown": 0.0,
            "lastSignal": None, "lastObserved": None, "lastQuote": None, "error": "",
            "interruptions": [], "verifiedContinuous": True, "startedAt": None,
            "swapLongUSD": None, "swapShortUSD": None, "swapHourUTC": None,
            "commissionUSD": 3.0, "slippageUSD": 0.05}


def limits(state):
    return {"dailyAvailable": state["equity"] - (state["dayBase"] - DAILY),
            "totalAvailable": state["equity"] - TOTAL_FLOOR,
            "remainingTarget": max(0.0, target(state["phase"]) - state["balance"])}


def reset_day(state, timestamp):
    day = day_at(timestamp)
    if state["day"] != day:
        state["day"] = day
        state["dayBase"] = state["balance"]


def mark(state, equity, timestamp):
    if not math.isfinite(equity):
        raise ValueError("Equity non finie : suivi interrompu.")
    reset_day(state, timestamp)
    state["equity"] = equity
    state["peak"] = max(state["peak"], equity)
    state["maxDrawdown"] = max(state["maxDrawdown"], state["peak"] - equity)
    if equity < max(TOTAL_FLOOR, state["dayBase"] - DAILY) - 1e-6:
        state["status"] = "FAILED"
        state["running"] = False
        state["error"] = "Limite FTMO obligatoire franchie sur l'equity virtuelle. Challenge arrete."
    return state["status"] == "FAILED"


def finish_phase(state, timestamp):
    if state["status"] in {"FAILED", "SUCCEEDED"} or state["position"] is not None:
        return False
    if state["balance"] < target(state["phase"]) or len(state["days"]) < 4:
        return False
    state["phases"].append({"phase": state["phase"], "start": state["startedAt"], "end": timestamp,
                             "balance": state["balance"], "gain": state["balance"] - INITIAL,
                             "days": len(state["days"]), "trades": sum(t["phase"] == state["phase"] for t in state["trades"]),
                             "maxDrawdown": state["maxDrawdown"], "status": "TARGET_CLOSED"})
    if state["phase"] == 2:
        state["status"] = "SUCCEEDED"
        state["running"] = False
    else:
        state.update(phase=2, status="PHASE_2", balance=INITIAL, equity=INITIAL,
                     day=day_at(timestamp), dayBase=INITIAL, days=[], peak=INITIAL,
                     maxDrawdown=0.0, startedAt=timestamp)
    return True


def volume(equity, price, distance, usd_per_eur, contract, minimum, step, maximum, spread, slippage, commission, extra_cost=0.0):
    values = [equity, price, distance, usd_per_eur, contract, minimum, step, maximum]
    if any(not math.isfinite(v) or v <= 0 for v in values) or any(not math.isfinite(v) or v < 0 for v in [spread, slippage, commission, extra_cost]):
        raise ValueError("Caracteristiques de contrat ou couts invalides.")
    cost = (distance + spread + 2 * slippage) * contract + 2 * commission + extra_cost
    risk_lots = equity * 0.005 * usd_per_eur / cost
    margin_lots = equity * 20 * usd_per_eur / (price * contract)
    lots = round(math.floor((min(risk_lots, margin_lots, maximum) + 1e-9) / step) * step, 8)
    if lots < minimum:
        return 0.0, 0.0
    risk = lots * cost / usd_per_eur
    if risk > equity * 0.005 + 1e-6:
        raise ValueError("Risque initial superieur a 0,5 %.")
    return lots, risk
