"""Targeted PAPER clock tests only; no terminal, orders, worker or backtest."""
import json
import threading
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from paper_trial import PaperTrial
from paper_time import PaperServerTimeBasis, StaleQuoteError, configured_paper_basis


class PaperTrialTimeTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 11, 3, 12, 4, 10, tzinfo=timezone.utc).timestamp()
        # Isolate clock tests from the user's configured historical periods.
        self.config = {"encoding": "SERVER_WALL", "serverPrefix": "FTMO-Demo",
                       "symbols": ["XAUUSD", "EURUSD"], "confirmation": "Test fixture only",
                       "periods": [{"fromUTC": "2026-11-02T00:00:00+00:00",
                                    "untilUTC": "2026-12-31T22:00:00+00:00", "offsetSeconds": 7200}]}
        config_patch = patch("paper_time.CONFIG_PATH", SimpleNamespace(read_text=lambda **_: json.dumps(self.config)))
        config_patch.start()
        self.addCleanup(config_patch.stop)
        self.account = SimpleNamespace(trade_mode=0, server="FTMO-Demo", login=123)
        self.ticks = {}
        self.bars = {}
        for symbol, age in (("XAUUSD", .256), ("EURUSD", 2.161)):
            raw = self.now + 7200 - age
            self.ticks[symbol] = SimpleNamespace(time=int(raw), time_msc=round(raw*1000),
                                                bid=2000. if symbol == "XAUUSD" else 1.1,
                                                ask=2000.2 if symbol == "XAUUSD" else 1.1002)
            self.bars[symbol] = int(raw//900)*900
        self.mt = SimpleNamespace(
            ACCOUNT_TRADE_MODE_DEMO=0, TIMEFRAME_M15=15,
            symbol_select=lambda *_: True,
            symbol_info_tick=lambda symbol: self.ticks[symbol],
            copy_rates_from_pos=lambda symbol, *_: [{"time": self.bars[symbol]}],
            symbol_info=lambda symbol: SimpleNamespace(
                currency_base="XAU" if symbol == "XAUUSD" else "EUR", currency_profit="USD",
                expiration_time=0, trade_calc_mode=0, trade_contract_size=100,
                volume_min=.01, volume_step=.01, volume_max=100))
        self.trial = PaperTrial.__new__(PaperTrial)
        self.trial.mt5 = self.mt
        self.trial.market_lock = threading.RLock()
        self.trial.state = {"running": True, "monitoringBlocked": False, "quoteWaiting": False,
                            "quoteWaitReason": None, "quoteWaitAge": None, "error": "", "position": None,
                            "lastObserved": self.now-1, "lastSignal": int(self.now//900)*900,
                            "interruptions": [], "trades": [], "equity": 20000., "balance": 20000.,
                            "curve": [], "status": "PHASE_1", "verifiedContinuous": True}
        self.trial.worker = {"status": "MONITORING", "heartbeat": self.now, "cause": None}
        self.trial.storage_fault = None
        self.trial.connected = True
        self.trial.feed = None
        self.trial.durable = json.loads(json.dumps(self.trial.state))
        self.trial.save = lambda: None
        # No terminal data path or native file exists in this fixture.
        self.trial.connect = lambda: (SimpleNamespace(), self.account)

    def market(self):
        with patch("time.time", return_value=self.now):
            return self.trial.market()

    def test_both_server_encoded_ticks_work_without_native_proof(self):
        feed = self.market()
        self.assertAlmostEqual(self.now-feed["time"], .256, places=3)
        self.assertAlmostEqual(self.now-feed["fxTime"], 2.161, places=3)
        self.assertEqual(feed["timeBasis"]["symbolEncodings"]["XAUUSD"]["encoding"], "SERVER_WALL")
        self.assertEqual(feed["timeBasis"]["symbolEncodings"]["EURUSD"]["encoding"], "SERVER_WALL")
        self.assertEqual(self.trial.basis.bars([self.bars["XAUUSD"]], self.now)[0], int(feed["time"]//900)*900)

    def test_exact_freshness_boundaries_and_future_stale_rejection(self):
        basis = configured_paper_basis(self.mt, self.account, self.now)
        for age in (0, 15, -.001, 15.001):
            raw = self.now + 7200 - age
            tick = SimpleNamespace(time=int(raw), time_msc=round(raw*1000))
            with self.subTest(age=age):
                if age in (0, 15):
                    self.assertAlmostEqual(self.now-basis.basis_for_tick(raw, self.now, "XAUUSD").tick(tick, "XAUUSD", self.now), age, places=3)
                elif age > 15:
                    with self.assertRaisesRegex(StaleQuoteError, "age apres normalisation"):
                        basis.basis_for_tick(raw, self.now, "XAUUSD").tick(tick, "XAUUSD", self.now)
                else:
                    with self.assertRaisesRegex(ValueError, "futur"):
                        basis.basis_for_tick(raw, self.now, "XAUUSD")

    def test_valid_utc_tick_is_not_shifted_by_configured_server_offset(self):
        raw = self.now - 1
        self.ticks["XAUUSD"] = SimpleNamespace(time=int(raw), time_msc=round(raw*1000), bid=2000., ask=2000.2)
        self.bars["XAUUSD"] = int(raw//900)*900
        feed = self.market()
        self.assertEqual(feed["timeBasis"]["symbolEncodings"]["XAUUSD"]["encoding"], "UTC")
        self.assertAlmostEqual(self.now-feed["time"], 1., places=3)

    def test_wrong_offset_quotes_are_not_relabelled_as_confirmed_server_time(self):
        for offset in (3600, 10800):
            raw = self.now + offset - 1
            self.ticks["XAUUSD"] = SimpleNamespace(time=int(raw), time_msc=round(raw*1000), bid=2000., ask=2000.2)
            with self.subTest(offset=offset), self.assertRaises(ValueError):
                self.market()

    def test_permanent_tick_error_takes_priority_over_other_stale_symbol(self):
        for stale_symbol, invalid_symbol in (("XAUUSD", "EURUSD"), ("EURUSD", "XAUUSD")):
            for symbol, age in ((stale_symbol, 15.7), (invalid_symbol, -.1)):
                raw = self.now + 7200 - age
                self.ticks[symbol] = SimpleNamespace(time=int(raw), time_msc=round(raw*1000),
                                                    bid=2000. if symbol == "XAUUSD" else 1.1,
                                                    ask=2000.2 if symbol == "XAUUSD" else 1.1002)
            with self.subTest(stale_symbol=stale_symbol):
                with self.assertRaises(ValueError) as raised:
                    self.market()
                self.assertNotIsInstance(raised.exception, StaleQuoteError)
                self.assertIn(invalid_symbol, str(raised.exception))
                self.assertIn("futur", str(raised.exception))

    def test_m15_is_checked_for_both_symbols(self):
        for symbol in ("XAUUSD", "EURUSD"):
            original = self.bars[symbol]
            self.bars[symbol] -= 900
            with self.subTest(symbol=symbol), self.assertRaisesRegex(ValueError, symbol+" non synchronises"):
                self.market()
            self.bars[symbol] = original

    def test_m15_in_utc_while_ticks_are_server_time_is_rejected(self):
        self.bars["EURUSD"] -= 7200
        with self.assertRaisesRegex(ValueError, "EURUSD non synchronises"):
            self.market()

    def test_time_and_time_msc_must_agree(self):
        self.ticks["XAUUSD"].time_msc += 1000
        with self.assertRaisesRegex(ValueError, "incoherents"):
            self.market()

    def test_other_broker_and_real_account_are_rejected(self):
        self.account.server = "Other-Demo"
        with self.assertRaisesRegex(ValueError, "serveur connecte"):
            self.market()
        self.account.server, self.account.trade_mode = "FTMO-Demo", 1
        with self.assertRaisesRegex(ValueError, "DEMO"):
            self.market()

    def test_no_assumed_offset_outside_configured_validity(self):
        self.now = datetime(2027, 1, 1, 12, tzinfo=timezone.utc).timestamp()
        self.ticks["XAUUSD"] = SimpleNamespace(time=int(self.now+7200-1), time_msc=round((self.now+7200-1)*1000), bid=2000., ask=2000.2)
        self.ticks["EURUSD"] = SimpleNamespace(time=int(self.now+7200-1), time_msc=round((self.now+7200-1)*1000), bid=1.1, ask=1.1002)
        self.bars["XAUUSD"] = int((self.now+7200-1)//900)*900
        self.bars["EURUSD"] = int((self.now+7200-1)//900)*900
        with self.assertRaisesRegex(ValueError, "hors periode"):
            self.market()

    def test_utc_direct_ticks_outside_server_period_are_allowed_if_fresh(self):
        self.now = datetime(2027, 1, 1, 12, tzinfo=timezone.utc).timestamp()
        for symbol in ("XAUUSD", "EURUSD"):
            raw = self.now - 1
            self.ticks[symbol] = SimpleNamespace(time=int(raw), time_msc=round(raw*1000),
                                                bid=2000. if symbol == "XAUUSD" else 1.1,
                                                ask=2000.2 if symbol == "XAUUSD" else 1.1002)
            self.bars[symbol] = int(raw//900)*900
        with patch("time.time", return_value=self.now):
            feed = self.trial.market()
        self.assertTrue(all(item["encoding"] == "UTC" for item in feed["timeBasis"]["symbolEncodings"].values()))

    def test_bars_after_confirmed_period_are_not_normalized(self):
        basis = configured_paper_basis(self.mt, self.account, self.now)
        january = datetime(2027, 1, 1, 12, tzinfo=timezone.utc).timestamp()
        with self.assertRaisesRegex(ValueError, "non definie"):
            basis.bars([january+7200], self.now)

    def test_unknown_historical_dates_are_not_converted_as_gmt_plus_two(self):
        basis = configured_paper_basis(self.mt, self.account, self.now)
        october = datetime(2026, 10, 30, 12, tzinfo=timezone.utc).timestamp()
        with self.assertRaisesRegex(ValueError, "non definie"):
            basis.bars([october+7200], self.now)

    def test_user_confirmed_offsets_switch_without_inventing_transition_dates(self):
        transition = self.now - 86400
        basis = PaperServerTimeBasis([(transition-86400, transition, 10800),
                                      (transition, transition+86400, 7200)])
        before, after = transition-14400, transition+14400
        self.assertEqual(basis.normalize(before+10800), before)
        self.assertEqual(basis.normalize(after+7200), after)
        with self.assertRaisesRegex(ValueError, "ambigue"):
            basis.normalize(transition+8000)

    def test_nonexistent_server_wall_time_is_rejected_between_confirmed_periods(self):
        transition = self.now - 86400
        basis = PaperServerTimeBasis([(transition-86400, transition, 7200),
                                      (transition+3600, transition+86400, 10800)])
        with self.assertRaisesRegex(ValueError, "non definie"):
            basis.normalize(transition+8000)

    def test_invalid_confirmation_or_offset_is_rejected(self):
        self.config["periods"][0]["offsetSeconds"] = 3600
        with self.assertRaisesRegex(ValueError, r"GMT\+2"):
            self.market()


if __name__ == "__main__":
    unittest.main()
