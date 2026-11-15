"""Isolated evidence-reader tests; no MT5, user ledger or historical execution."""
import hashlib
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from historical_evidence import ARCHIVE_NAME, inspect_evidence, inspect_available_evidence


class HistoricalEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.root = base / "ftmo"
        reference = self.root / "reference"
        (reference / "resultats").mkdir(parents=True)
        bridge = base / "mt5_bridge"
        bridge.mkdir()
        self.sources = [self.root / name for name in ("core.py", "frozen.py", "verify.py")] + [bridge / "ftmo_service.py"]
        for path in self.sources:
            path.write_bytes(b"synthetic fixture, never imported")
        self.archive = reference / ARCHIVE_NAME
        replays = []
        with zipfile.ZipFile(self.archive, "w") as archive:
            for year in (2025, 2026):
                for tp, label in ((2.5, "2p5"), (5.0, "5")):
                    summary = {"year": year, "tpR": tp, "spread": .3, "phases_reset": True,
                               "trades": 1, "net": 1, "phase1_end": None, "phase2_end": None, "FTMO_equity_fail": False}
                    stem = f"resultats/ftmo_20k_{year}_tp{label}"
                    for suffix, content in ((".json", json.dumps({"summary": summary}).encode()), ("_trades.csv", b"pnl\n1\n")):
                        archive.writestr(stem + suffix, content)
                        (reference / (stem + suffix)).write_bytes(content)
                    replays.append({"year": year, "tpR": tp, "passed": True, "errors": [], "summary": summary})
        digest = hashlib.sha256()
        for path in self.sources + [self.archive]:
            digest.update(path.read_bytes())
        self.report = {"status": "PASSED", "unitPassed": True, "unitTests": 12,
                       "implementationHash": digest.hexdigest(), "archiveSha256": hashlib.sha256(self.archive.read_bytes()).hexdigest(),
                       "replays": replays, "signalChecks": [{"passed": True}]}
        self.report_path = base / "verification.json"
        self.write_report()

    def write_report(self):
        self.report_path.write_text(json.dumps(self.report), encoding="utf-8")

    def inspect(self):
        return inspect_evidence(self.root, self.report_path)

    def test_existing_evidence_is_read_only_and_never_authorizes_start(self):
        before = {p: p.read_bytes() for p in Path(self.temp.name).rglob("*") if p.is_file()}
        result = self.inspect()
        self.assertEqual(result["historicalIntegrity"], "MATCHES_LOCAL_ARCHIVE")
        self.assertEqual(result["verificationEvidence"], "CORROBORATED_LEGACY_REPORT")
        self.assertFalse(result["authorizationToStart"])
        self.assertFalse(result["replaysRun"])
        self.assertEqual(before, {p: p.read_bytes() for p in Path(self.temp.name).rglob("*") if p.is_file()})

    def test_not_run_is_not_replaced_with_success(self):
        self.report_path.unlink()
        result = self.inspect()
        self.assertEqual(result["historicalIntegrity"], "MATCHES_LOCAL_ARCHIVE")
        self.assertEqual(result["verificationEvidence"], "BLOCKED")
        self.assertFalse(self.report_path.exists())

    def test_modified_or_missing_result_is_not_reused(self):
        path = self.root / "reference/resultats/ftmo_20k_2025_tp2p5.json"
        path.write_text("{}")
        self.assertEqual(self.inspect()["verificationEvidence"], "BLOCKED")
        path.unlink()
        self.assertEqual(self.inspect()["historicalIntegrity"], "UNVERIFIABLE")

    def test_missing_archive_blocks(self):
        self.archive.unlink()
        self.assertEqual(self.inspect()["historicalIntegrity"], "UNVERIFIABLE")

    def test_stale_implementation_blocks(self):
        self.sources[0].write_bytes(b"changed")
        self.assertEqual(self.inspect()["verificationEvidence"], "BLOCKED")

    def test_status_alone_is_not_proof(self):
        self.report = {"status": "PASSED"}
        self.write_report()
        self.assertEqual(self.inspect()["verificationEvidence"], "BLOCKED")

    def test_missing_or_duplicate_replay_proof_blocks(self):
        self.report["replays"][3] = self.report["replays"][0]
        self.write_report()
        self.assertEqual(self.inspect()["verificationEvidence"], "BLOCKED")

    def test_summary_difference_blocks(self):
        self.report["replays"][0]["summary"]["net"] = 999
        self.write_report()
        self.assertEqual(self.inspect()["verificationEvidence"], "BLOCKED")

    def test_failed_signal_check_blocks(self):
        self.report["signalChecks"][0]["passed"] = False
        self.write_report()
        self.assertEqual(self.inspect()["verificationEvidence"], "BLOCKED")

    def test_backup_attestation_is_not_engine_verification(self):
        self.report = {"format": "tradebot-external-backup-verification", "status": "VERIFIED",
                       "backtestReproductionVerified": False, "mt5WindowsConnectionVerified": False}
        self.write_report()
        result = self.inspect()
        self.assertEqual(result["verificationEvidence"], "BLOCKED")
        self.assertIn("sauvegarde externe", result["verificationErrors"][0])

    def test_archived_engine_report_is_examined_but_not_installed(self):
        archived = self.root / "reference/verification-old.json"
        archived.write_bytes(self.report_path.read_bytes())
        self.report_path.unlink()
        result = inspect_available_evidence(self.root, self.report_path)
        self.assertEqual(result["archivedReports"][0]["verificationEvidence"], "CORROBORATED_LEGACY_REPORT")
        self.assertFalse(result["reportRestored"])
        self.assertFalse(result["authorizationToStart"])
        self.assertFalse(self.report_path.exists())

    def test_absent_report_is_explicit_even_if_results_match(self):
        self.report_path.unlink()
        result = inspect_available_evidence(self.root, self.report_path)
        self.assertEqual(result["archivedReports"], [])
        self.assertEqual(result["historicalIntegrity"], "MATCHES_LOCAL_ARCHIVE")
        self.assertEqual(result["verificationEvidence"], "BLOCKED")
        self.assertIn("Aucun PASSED", result["notRunExplanation"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
