"""Diagnostic-only fixtures. No terminal, FTMO service, worker or backtest."""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import clock_evidence as diagnostic
import test_time_basis as fixtures


class ClockDiagnosticV75Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.proof, self.mt, self.account, self.now = fixtures.TimeBasisTests().fixture("UTC")
        self.path = Path(self.temp.name) / "MQL5" / "Files" / "tradebot-clock-proof.json"
        self.path.parent.mkdir(parents=True)
        self.path.write_text(json.dumps(self.proof), encoding="utf-8")
        self.terminal = SimpleNamespace(data_path=self.temp.name, build=5000)
        self.mt.__version__ = "synthetic-v75"
        self.mt.symbols_get = lambda: [SimpleNamespace(name="EURUSD", currency_base="EUR", currency_profit="USD", expiration_time=0)]
        self.mt.last_error = lambda: (0, "fixture")

    def collect(self):
        with patch.object(diagnostic, "run_clock_tests", return_value={"passed": True, "tests": 0, "failures": 0, "errors": 0}), \
             patch.object(diagnostic.time, "time", return_value=self.now), \
             patch.object(diagnostic.time, "sleep"):
            return diagnostic.clock_evidence(self.mt, self.terminal, self.account)

    def test_native_source_and_runtime_identity_are_explicit(self):
        result = self.collect()
        self.assertEqual(result["nativeProbeSource"], str(self.path))
        self.assertEqual(result["accountLogin"], str(self.account.login))
        self.assertEqual(result["nativeProofStatus"], "VERIFIED")
        self.assertEqual(result["quotesStatus"], "AVAILABLE")
        self.assertEqual(result["nativeProbe"], self.proof)
        self.assertEqual(result["normalization"]["validUntilUTC"], diagnostic.utc(self.now + 120))

    def test_missing_file_never_creates_proof(self):
        self.path.unlink()
        result = self.collect()
        self.assertIsNone(result["nativeProbe"])
        self.assertIsNone(result["normalization"])
        self.assertEqual(result["nativeProofStatus"], "UNVERIFIABLE")
        self.assertFalse(self.path.exists())

    def test_expired_proof_cannot_validate_even_with_fresh_python_ticks(self):
        self.proof["timeGMT"] = self.now - 121
        self.path.write_text(json.dumps(self.proof), encoding="utf-8")
        result = self.collect()
        self.assertIsNone(result["normalization"])
        self.assertEqual(result["nativeProofStatus"], "UNVERIFIABLE")
        self.assertIn("expire", result["nativeProbeError"])
        self.assertEqual(result["utcValidationDetails"]["nativeAgeSeconds"], 121)
        self.assertEqual(result["utcValidationDetails"]["pythonValidationError"], result["nativeProbeError"])
        self.assertEqual(result["diagnosticSchemaVersion"], 76)
        self.assertIsNone(result["fees"]["swapHourUTC"])

    def test_wrong_account_is_refused(self):
        self.proof["login"] = 999
        self.path.write_text(json.dumps(self.proof), encoding="utf-8")
        result = self.collect()
        self.assertIsNone(result["nativeProbe"])
        self.assertIsNone(result["normalization"])
        self.assertNotEqual(result["nativeProofStatus"], "VERIFIED")
        self.assertEqual(result["utcValidationDetails"]["stage"], "ACCOUNT_IDENTITY")
        self.assertFalse(result["utcValidationDetails"]["loginMatches"])

    def test_absent_quotes_are_explicit_without_claiming_market_schedule(self):
        self.mt.symbol_info_tick = lambda _: None
        result = self.collect()
        self.assertEqual(result["quotesStatus"], "UNAVAILABLE")
        self.assertIsNone(result["normalization"])
        self.assertFalse(result["ordersSent"])

    def test_normalized_stale_quotes_keep_fifteen_second_limit(self):
        self.mt.symbol_info_tick = lambda _: fixtures.tick(self.now - 15.001)
        result = self.collect()
        self.assertEqual(result["quotesStatus"], "UNAVAILABLE")
        self.assertIsNone(result["normalization"])
        self.assertIn("15 s", result["nativeProbeError"])

    def test_displayed_proof_is_read_once_and_is_the_validated_object(self):
        original = Path.read_text
        reads = []
        def read(path, *args, **kwargs):
            if path == self.path:
                reads.append(path)
            return original(path, *args, **kwargs)
        with patch.object(Path, "read_text", read), \
             patch.object(diagnostic, "validate_time_basis", wraps=diagnostic.validate_time_basis) as validate:
            result = self.collect()
        self.assertEqual(len(reads), 1)
        self.assertIs(validate.call_args.args[0], result["nativeProbe"])

    def test_invalid_json_never_falls_back_to_old_or_fabricated_proof(self):
        self.path.write_text("{partial", encoding="utf-8")
        result = self.collect()
        self.assertIsNone(result["nativeProbe"])
        self.assertIsNone(result["normalization"])
        self.assertEqual(result["nativeProofStatus"], "UNVERIFIABLE")
        self.assertEqual(self.path.read_text(encoding="utf-8"), "{partial")

    def test_closed_market_or_unsynchronized_clocks_remain_unavailable(self):
        self.proof["timeCurrent"] -= 60
        self.path.write_text(json.dumps(self.proof), encoding="utf-8")
        result = self.collect()
        self.assertEqual(result["quotesStatus"], "UNAVAILABLE")
        self.assertIsNone(result["normalization"])
        self.assertNotEqual(result["nativeProofStatus"], "VERIFIED")


if __name__ == "__main__":
    unittest.main(verbosity=2)
