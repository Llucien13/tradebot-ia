"""Source-contract tests for the read-only Windows PAPER diagnostic."""
import re
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("controler_preparation_paper.ps1")


class PreparationDiagnosticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = SCRIPT.read_text(encoding="utf-8")

    def test_challenge_phase_never_means_worker_stopped(self):
        self.assertIn("state.status est seulement PHASE_1/PHASE_2/FAILED/SUCCEEDED", self.source)
        self.assertNotRegex(self.source, r"state\.status.{0,100}STOPPED.{0,60}VERIFIE")
        self.assertIn("Statut du challenge", self.source)
        self.assertIn("'NON VERIFIABLE'", self.source)

    def test_absent_worker_and_heartbeat_are_unverifiable(self):
        absent_branch = self.source[self.source.index("function Check-Worker") : self.source.index("function Test-QuoteUnavailable")]
        self.assertIn("if ($null -eq $worker)", absent_branch)
        self.assertIn("Statut du worker' 'NON VERIFIABLE'", absent_branch)
        self.assertIn("Heartbeat du worker' 'NON VERIFIABLE'", absent_branch)
        self.assertIn("return [ordered]@{ status = $null; alive = $null; heartbeatAgeSeconds = $null; verifiable = $false }", absent_branch)

    def test_native_proof_requires_freshness_identity_and_expiry(self):
        proof = self.source[self.source.index("function Test-NativeProof") : self.source.index("function Safe-FeedSummary")]
        self.assertIn("schemaVersion", proof)
        self.assertIn("ExpectedServer", proof)
        self.assertIn("ExpectedLogin", proof)
        self.assertIn("$age -gt 120", proof)
        self.assertIn("$expiry - ($gmt + 120)", proof)
        self.assertIn("confirmedPolicy", proof)
        self.assertIn("'NON VERIFIABLE'", proof)
        self.assertIn("aucun offset infere", proof)

    def test_quote_freshness_is_never_relaxed_and_closed_market_is_labeled(self):
        self.assertIn("'COTATIONS INDISPONIBLES'", self.source)
        self.assertIn("goldTickAgeSeconds -gt 15", self.source)
        self.assertIn("fxTickAgeSeconds -gt 15", self.source)
        self.assertIn("maximum 120 s", self.source)
        self.assertIn("seuil de fraicheur de 15 s inchange", self.source)

    def test_only_get_routes_and_safe_challenge_defaults(self):
        routes = re.findall(r"Get-Local '([^']+)'", self.source)
        self.assertTrue(routes)
        self.assertTrue(set(routes).issubset({"/ftmo/state", "/ftmo/clock-evidence", "/ftmo/feed"}))
        self.assertIn("-Method Get", self.source)
        for forbidden in ("/ftmo/start", "/ftmo/stop", "/ftmo/reset", "/ftmo/verify", "order_send", "order_check"):
            self.assertNotIn(forbidden, self.source)
        self.assertIn("$report['verdict'] = 'NON_PRET_CONTROLES_PARTIELS'", self.source)

    def test_market_closed_never_produces_synthetic_quote(self):
        self.assertIn("aucun tick estime/invente", self.source)
        self.assertIn("Aucun prix substitue", self.source)
        self.assertNotIn("$feed.feed.bid =", self.source)
        self.assertNotIn("$feed.feed.ask =", self.source)

    def test_passed_flag_requires_independent_existing_evidence(self):
        guard = self.source[self.source.index("function Guard-State") : self.source.index("function Ledger-Fingerprint")]
        self.assertIn("-eq 'PASSED' -and $script:historicalEvidenceValid", guard)
        self.assertIn("historical_evidence.py", self.source)
        self.assertIn("CORROBORATED_LEGACY_REPORT", self.source)
        reader = SCRIPT.with_name("historical_evidence.py").read_text(encoding="utf-8")
        for forbidden in ("import MetaTrader5", "from verify import", "from frozen import", "from FTMO_20K_EUR_RUN import", "extractall(", "write_text(", "write_bytes("):
            self.assertNotIn(forbidden, reader)

    def test_failure_still_checks_ledger_and_never_reports_ready(self):
        final = self.source[self.source.index("} finally {") :]
        self.assertIn("$finalDisk = Read-Checkpoint $checkpoint", final)
        self.assertIn("$exitCode = 2", final)
        self.assertIn("$expectedDaily", self.source)
        self.assertIn("$expectedTotal", self.source)
        self.assertIn("Registre runtime different du checkpoint disque", self.source)

    def test_v76_failure_details_are_saved_before_quote_rejection(self):
        save = self.source.index("$report['utcValidationDetails'] = Value $clock 'utcValidationDetails'")
        stop = self.source.index("if (Test-QuoteUnavailable $clock) {", save)
        self.assertLess(save, stop)
        self.assertIn("$report['ftmoFeesEvidence'] = Value $clock 'fees'", self.source)
        self.assertIn("Cause exacte validation UTC Python", self.source)
        self.assertIn("Collecteur V76 absent", self.source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
