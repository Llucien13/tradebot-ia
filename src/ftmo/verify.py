"""Targeted original replays + financial invariants. Never runs research main()."""
import hashlib
import json
import sys
import unittest
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REFERENCE = ROOT / "reference"
ARCHIVE = REFERENCE / "TradeBot_FTMO_20K_EUR_Backtest_PAPER_2025_2026.zip"


def implementation_hash():
    digest = hashlib.sha256()
    for file in [ROOT / "core.py", ROOT / "frozen.py", ROOT / "verify.py", ROOT.parent / "mt5_bridge" / "ftmo_service.py", ARCHIVE]:
        digest.update(file.read_bytes())
    return digest.hexdigest()


def extract_reference():
    with zipfile.ZipFile(ARCHIVE) as archive:
        for item in archive.infolist():
            destination = (REFERENCE / item.filename).resolve()
            if not destination.is_relative_to(REFERENCE.resolve()) or item.is_dir():
                if item.is_dir():
                    continue
                raise ValueError("Chemin archive refuse.")
            content = archive.read(item)
            if destination.exists():
                if destination.read_bytes() != content:
                    raise ValueError("Reference originale modifiee : " + item.filename)
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(content)


def run_checks(output):
    from core import new_state, volume, mark, finish_phase, reset_day, day_at
    class Rules(unittest.TestCase):
        def test_initial(self):
            s = new_state()
            self.assertEqual(s["equity"], 20000)
            self.assertFalse(s["running"])
            self.assertFalse(s["liveEnabled"])
        def test_risk(self):
            lot, risk = volume(20000, 3000, 20, 1.15, 100, .01, .01, 100, .3, .05, 3)
            self.assertGreater(lot, 0)
            self.assertLessEqual(risk, 100)
        def test_minlot(self):
            lot, risk = volume(1, 3000, 20, 1.15, 100, .01, .01, 100, .3, .05, 3)
            self.assertEqual(lot, 0)
        def test_swap_risk_reserve(self):
            lot, risk = volume(20000, 3000, 20, 1.15, 100, .01, .01, 100, .3, .05, 3, 150)
            self.assertGreater(lot, 0)
            self.assertLessEqual(risk, 100)
        def test_usd_eur_commissions_swaps(self):
            sys.path.insert(0, str(ROOT.parent / "mt5_bridge"))
            from ftmo_service import FTMOService
            service = FTMOService.__new__(FTMOService)
            service.state = new_state()
            s = service.state
            entry_commission = .03 / 1.2
            s["balance"] = 20000 - entry_commission - .01
            s["position"] = {"phase": 1, "entry": 100, "side": 1, "contract": 100, "lots": .01,
                             "entryCommissionEUR": entry_commission, "swapsEUR": -.01}
            service.close_position(101, "SL", {"fx": 1.25, "time": 1735689600})
            expected = (1-.03)/1.25-entry_commission-.01
            self.assertAlmostEqual(s["trades"][0]["pnl"], expected)
            self.assertAlmostEqual(s["balance"], 20000+expected)
        def test_daily_float(self):
            s = new_state()
            self.assertTrue(mark(s, 18999, 1735689600))
        def test_fixed_floor(self):
            s = new_state(); s["balance"] = 22000
            mark(s, 22000, 1735689600)
            self.assertFalse(mark(s, 21000, 1735689601))
            self.assertTrue(mark(s, 20999, 1735689602))
        def test_total(self):
            s = new_state(); s["balance"] = 18500
            self.assertTrue(mark(s, 17999, 1735689600))
        def test_minimum_days(self):
            s = new_state(); s["balance"] = 22000; s["days"] = ["1", "2", "3"]
            self.assertFalse(finish_phase(s, 1735689600))
            s["days"].append("4")
            self.assertTrue(finish_phase(s, 1735689600))
            self.assertEqual(s["balance"], 20000)
            self.assertEqual(s["phase"], 2)
            self.assertNotEqual(s["status"], "SUCCEEDED")
            s["balance"] = 21000; s["days"] = ["1", "2", "3", "4"]
            self.assertTrue(finish_phase(s, 1735689601))
            self.assertEqual(s["status"], "SUCCEEDED")
        def test_no_pass_open_position(self):
            s = new_state(); s["balance"] = 23000; s["days"] = ["1", "2", "3", "4"]; s["position"] = {}
            self.assertFalse(finish_phase(s, 1735689600))
        def test_prague_dst(self):
            stamp = lambda t: datetime.fromisoformat(t).replace(tzinfo=timezone.utc).timestamp()
            self.assertEqual(day_at(stamp("2025-03-30T21:59:59")), "2025-03-30")
            self.assertEqual(day_at(stamp("2025-03-30T22:00:00")), "2025-03-31")
            self.assertEqual(day_at(stamp("2025-10-26T22:59:59")), "2025-10-26")
            self.assertEqual(day_at(stamp("2025-10-26T23:00:00")), "2025-10-27")
        def test_midnight_balance_not_float(self):
            s = new_state(); s["balance"] = 20100; s["equity"] = 20500
            reset_day(s, 1735689600)
            self.assertEqual(s["dayBase"], 20100)
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(Rules))
    report = {"status": "FAILED", "unitTests": result.testsRun, "unitPassed": result.wasSuccessful(), "replays": [], "signalChecks": [],
              "warning": "Replay OHLC original, jour serveur et FX original. Pas de certification FTMO, ni hors echantillon."}
    if not result.wasSuccessful():
        output.write_text(json.dumps(report, indent=2), encoding="utf-8")
        return
    extract_reference()
    sys.path.insert(0, str(REFERENCE))
    import numpy as np
    import pandas as pd
    report.update(implementationHash=implementation_hash(), numpyVersion=np.__version__, pandasVersion=pd.__version__, archiveSha256=hashlib.sha256(ARCHIVE.read_bytes()).hexdigest())
    from FTMO_20K_EUR_RUN import replay, GO, idx, DIST
    from recherche_m15 import m15, h1, h4, d1, m30
    from frozen import frozen_signal
    selected = sorted(set([1000, 5000, 10000, len(idx)-2] + [int(i) for i in np.flatnonzero(GO)[:4]]))
    for i in selected:
        at = idx[i]
        frames = {k: frame.loc[:at] for k, frame in {"m15": m15, "h1": h1, "h4": h4, "d1": d1, "m30": m30}.items()}
        side, dist, time = frozen_signal(frames)
        same_dist = bool(np.isclose(dist, float(DIST[i]), atol=1e-6, rtol=1e-9, equal_nan=True))
        report["signalChecks"].append({"time": str(at), "originalSide": int(GO[i]), "adapterSide": side,
                                      "originalDistance": float(DIST[i]), "adapterDistance": dist,
                                      "passed": side == int(GO[i]) and same_dist and time == at})
    for year in [2025, 2026]:
        for tp in [2.5, 5.0]:
            label = f"ftmo_20k_{year}_tp{'2p5' if tp == 2.5 else '5'}"
            expected = json.loads((REFERENCE / "resultats" / (label + ".json")).read_text())
            summary, trades, monthly, phases, fail = replay(year, tp, spread=.30, phase_reset=True)
            stored = pd.read_csv(REFERENCE / "resultats" / (label + "_trades.csv"))
            errors = []
            for key in ["trades", "net", "phase1_end", "phase2_end", "FTMO_equity_fail"]:
                if summary[key] != expected["summary"][key]:
                    errors.append({"field": key, "expected": expected["summary"][key], "actual": summary[key]})
            if len(stored) != len(trades):
                errors.append({"field": "transaction_count", "expected": len(stored), "actual": len(trades)})
            else:
                for col in stored.columns:
                    if col not in trades.columns:
                        errors.append({"field": col, "cause": "Colonne absente"}); continue
                    if pd.api.types.is_numeric_dtype(stored[col]):
                        equal = bool(np.allclose(stored[col], trades[col], atol=1e-6, rtol=1e-9, equal_nan=True))
                    else:
                        equal = bool((stored[col].fillna("").astype(str).to_numpy() == trades[col].fillna("").astype(str).to_numpy()).all())
                    if not equal:
                        errors.append({"field": col, "cause": "Ecart dans les transactions, precision/pandas/donnees a examiner"})
            report["replays"].append({"year": year, "tpR": tp, "passed": not errors, "errors": errors, "summary": summary, "phases": phases})
    report["status"] = "PASSED" if all(r["passed"] for r in report["replays"] + report["signalChecks"]) else "DIFFERENCES"
    output.write_text(json.dumps(report, indent=2, default=float), encoding="utf-8")


if __name__ == "__main__":
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "verification.json"
    try:
        run_checks(output)
    except Exception as error:
        output.write_text(json.dumps({"status": "ERROR", "error": str(error)}), encoding="utf-8")
        raise
