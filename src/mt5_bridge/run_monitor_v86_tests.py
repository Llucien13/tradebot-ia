"""Runs V85/V86 and V87 isolation tests without starting any bridge or worker."""
import hashlib
import io
import json
import os
import subprocess
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[1]
BASELINE = "7f1412ee718671bc82b0ce40b47ee7bbfde40bb0"
PROTECTED = [ROOT/name for name in ("paper_time.py", "paper_time_config.json", "paper_storage.py",
         "ftmo_service.py", "time_basis.py", "quote_time.py", "server_clock.py", "test_paper_trial_time.py",
             "test_paper_trial_waiting.py", "test_paper_safety.py")]
PROTECTED += [ROOT.parent/"ftmo"/name for name in ("core.py", "frozen.py", "verify.py")]
# These files intentionally differ from V85, but must not change during tests.
CHECKED = PROTECTED + [ROOT/name for name in ("paper_trial.py", "weekly_gap.py", "monitor_store.py",
                                             "paper_monitor.py", "test_weekly_gap_v87.py")]


def hashes():
    return {str(p.relative_to(PROJECT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in CHECKED}


def main():
    before = hashes()
    baseline = {"status": "NOT_CHECKED", "reason": "Git absent ou commit V85 indisponible"}
    try:
        differences = []
        for path in PROTECTED:
            name = path.relative_to(PROJECT).as_posix()
            original = subprocess.run(["git", "show", BASELINE+":"+name], cwd=PROJECT,
                                      stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10, check=True).stdout
            # Git attributes / Windows checkouts may change line endings only.
            if original.replace(b"\r\n", b"\n") != path.read_bytes().replace(b"\r\n", b"\n"):
                differences.append(name)
        baseline = {"status": "MATCH" if not differences else "DIFFERENT", "differences": differences}
    except (OSError, subprocess.SubprocessError):
        pass
    loader = unittest.defaultTestLoader
    modules = ["test_paper_trial_time", "test_paper_trial_waiting", "test_quote_time", "test_time_basis", "test_paper_safety", "test_monitor_v86", "test_manual_positions_v87", "test_weekly_gap_v87"]
    output = io.StringIO()
    suite = unittest.TestSuite(loader.loadTestsFromName(name) for name in modules)
    result = unittest.TextTestRunner(stream=output, verbosity=2).run(suite)
    after = hashes()
    text = output.getvalue()
    print(text)
    report = {"version": 87, "atUTC": datetime.now(timezone.utc).isoformat(),
              "kind": "ISOLATED_UNIT_TESTS_NOT_REAL_MT5_EVIDENCE", "modules": modules,
              "tests": result.testsRun, "failures": len(result.failures), "errors": len(result.errors),
              "skipped": len(result.skipped), "passed": result.wasSuccessful(),
              "protectedFilesUnchangedDuringTests": before == after, "v85Baseline": baseline,
              "v85BaselineScope": [p.relative_to(PROJECT).as_posix() for p in PROTECTED],
              "intentionalAntiGapChangesExcludedFromV85Comparison": ["src/mt5_bridge/paper_trial.py", "src/mt5_bridge/weekly_gap.py"],
              "protectedSha256": after, "output": text,
              "realMT5Validated": False, "safariValidated": False, "remoteAccessEnabled": False}
    directory = Path(os.environ.get("LOCALAPPDATA", str(Path.home())))/"TradeBotIA"/"validation-v87"
    directory.mkdir(parents=True, exist_ok=True)
    (directory/"tests-v87.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    (directory/"tests-v87.txt").write_text(text, encoding="utf-8")
    print("Rapports :", directory)
    print("Comparaison sources V85 :", baseline["status"])
    print("Aucune preuve de fonctionnement MT5 reel ou Safari dans ces tests.")
    return 0 if result.wasSuccessful() and before == after and baseline["status"] != "DIFFERENT" else 1


if __name__ == "__main__":
    raise SystemExit(main())
