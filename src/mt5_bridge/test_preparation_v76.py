"""V76 isolated metadata tests: no MT5 terminal, ledger or historical engine."""
import json
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace as NS
from unittest.mock import Mock

from preparation_evidence_v76 import fee_evidence, utc_context
from time_basis import TimeBasis


class FeeEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 7, 1, tzinfo=timezone.utc).timestamp()
        self.account = NS(server="FTMO-Demo", login=123, trade_mode=0, currency="EUR")
        self.info = NS(swap_mode=1, swap_long=-12.5, swap_short=3.5, swap_rollover3days=3,
                       point=.01, trade_contract_size=100., trade_calc_mode=1,
                       currency_base="XAU", currency_profit="USD", currency_margin="USD")
        self.mt = NS(ACCOUNT_TRADE_MODE_DEMO=0, SYMBOL_CALC_MODE_CFD=1)
        self.fx_info = NS(currency_base="EUR", currency_profit="USD")
        self.mt.symbol_info = lambda symbol: self.info if symbol == "XAUUSD" else self.fx_info
        self.mt.symbol_info_tick = lambda _: NS(bid=1.1, ask=1.2, time=int(self.now), time_msc=int(self.now * 1000))
        # These must never be reached even when conversions fail.
        self.mt.order_send = Mock(side_effect=AssertionError("No orders allowed"))
        self.mt.order_check = Mock(side_effect=AssertionError("No order checks allowed"))

    def collect(self, basis=None):
        result = fee_evidence(self.mt, self.account, basis, self.now, "EURUSD")
        self.mt.order_send.assert_not_called()
        self.mt.order_check.assert_not_called()
        self.assertIsNone(result["swapHourUTC"])
        self.assertFalse(result["appliedToLedger"])
        return result

    def test_points_preserve_sign_and_do_not_triple_amount(self):
        self.info.point = .001
        result = self.collect()
        self.assertAlmostEqual(result["swapLongUSD"], -1.25)
        self.assertAlmostEqual(result["swapShortUSD"], .35)
        self.assertEqual(result["raw"]["swap_rollover3days"], 3)

    def test_margin_currency_usd(self):
        self.info.swap_mode = 3
        self.assertEqual(self.collect()["swapLongUSD"], -12.5)

    def test_currency_symbol_is_base_not_profit_currency(self):
        self.info.swap_mode = 2
        self.assertIsNone(self.collect()["swapLongUSD"])

    def test_deposit_eur_requires_fresh_verified_fx(self):
        self.info.swap_mode = 4
        self.assertIsNone(self.collect()["swapLongUSD"])
        result = self.collect(TimeBasis(valid_until=self.now + 120))
        self.assertAlmostEqual(result["swapLongUSD"], -12.5 * 1.15)

    def test_stale_or_future_fx_is_blocked(self):
        self.info.swap_mode = 4
        for age in (16, -1):
            stamp = self.now - age
            self.mt.symbol_info_tick = lambda _: NS(bid=1.1, ask=1.2, time=int(stamp), time_msc=int(stamp * 1000))
            self.assertIsNone(self.collect(TimeBasis(valid_until=self.now + 120))["swapLongUSD"])

    def test_disabled_swaps_are_explicit_not_a_fallback(self):
        self.info.swap_mode = 0
        self.assertIsNone(self.collect()["swapLongUSD"])
        self.info.swap_long = self.info.swap_short = 0.
        self.assertEqual(self.collect()["swapLongUSD"], 0.)

    def test_interest_reopen_and_unknown_modes_are_blocked(self):
        for mode in (5, 6, 7, 8, 99):
            self.info.swap_mode = mode
            self.assertIsNone(self.collect()["swapLongUSD"])

    def test_unsupported_contract_or_account_is_blocked(self):
        self.info.trade_calc_mode = 99
        self.assertIsNone(self.collect()["swapLongUSD"])
        self.info.trade_calc_mode = 1
        self.account.server = "Another-Demo"
        self.assertIsNone(self.collect()["swapLongUSD"])

    def test_no_missing_or_nonfinite_swap_is_replaced(self):
        for value in (None, float("nan"), float("inf")):
            self.info.swap_long = value
            result = self.collect()
            self.assertIsNone(result["swapLongUSD"])
            json.dumps(result, allow_nan=False)


class UTCContextTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 7, 1, tzinfo=timezone.utc).timestamp()
        self.account = NS(server="FTMO-Demo", login=123)
        self.proof = {"server": "FTMO-Demo", "login": 123, "timeGMT": self.now,
                      "timeTradeServer": self.now, "timeCurrent": self.now,
                      "confirmedPolicy": {"confirmed": False, "source": "", "ianaZone": ""}}

    def collect(self, error="error fixture"):
        return utc_context(self.proof, self.account, self.now, "PYTHON_TIME_BASIS_VALIDATION", error)

    def test_exact_error_and_expired_age_are_preserved(self):
        self.proof["timeGMT"] -= 121
        result = self.collect("Releve natif expire")
        self.assertEqual(result["nativeAgeSeconds"], 121)
        self.assertEqual(result["pythonValidationError"], "Releve natif expire")
        self.assertFalse(result["annualPolicyExternallyVerified"])

    def test_wrong_account_is_diagnosed_not_normalized(self):
        self.proof["login"] = 999
        self.assertFalse(self.collect()["loginMatches"])

    def test_missing_policy_never_selects_a_zone(self):
        result = self.collect()
        self.assertEqual(result["annualPolicyStatus"], "UNVERIFIABLE")
        self.assertNotIn("declaredIANAZone", result)

    def test_annual_calendar_is_only_that_of_the_declared_fixture_zone(self):
        # Synthetic rule for the test, not a claim about FTMO.
        self.proof["confirmedPolicy"] = {"confirmed": True, "source": "synthetic test only", "ianaZone": "Europe/Prague"}
        self.proof["timeTradeServer"] = self.now + 7200
        result = self.collect()
        self.assertEqual(result["annualPolicyStatus"], "DECLARED_RULE_CONSISTENT_NOW")
        transitions = result["annualTransitionsFromDeclaredZone"]
        self.assertEqual([item["utc"] for item in transitions], ["2026-03-29T01:00:00+00:00", "2026-10-25T01:00:00+00:00"])
        self.assertFalse(result["annualPolicyExternallyVerified"])
        self.proof["timeTradeServer"] += 3600
        self.assertEqual(self.collect()["annualPolicyStatus"], "DECLARED_RULE_CONTRADICTS_CAPTURE")

    def test_unknown_iana_zone_has_no_fixed_offset_fallback(self):
        self.proof["confirmedPolicy"] = {"confirmed": True, "source": "synthetic", "ianaZone": "Not/A_Zone"}
        self.assertEqual(self.collect()["annualPolicyStatus"], "UNVERIFIABLE")


if __name__ == "__main__":
    unittest.main(verbosity=2)
