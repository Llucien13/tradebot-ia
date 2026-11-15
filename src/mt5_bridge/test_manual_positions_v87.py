"""V87 broker-position observation tests. Fake MT5 values; never connects or sends orders."""
import threading
import unittest
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock, patch

from manual_positions import ManualPositionsReader, account_mode, exposure_review, provenance, serialize
from paper_trial import PaperTrial, new_state
from paper_time import StaleQuoteError


class ManualPositionTests(unittest.TestCase):
    def setUp(self):
        self.mt = SimpleNamespace(
            ACCOUNT_MARGIN_MODE_RETAIL_NETTING=0,
            ACCOUNT_MARGIN_MODE_EXCHANGE=1,
            ACCOUNT_MARGIN_MODE_RETAIL_HEDGING=2,
            ACCOUNT_TRADE_MODE_DEMO=0,
            ACCOUNT_TRADE_MODE_REAL=1,
            ACCOUNT_TRADE_MODE_CONTEST=2,
            POSITION_TYPE_BUY=0,
            POSITION_TYPE_SELL=1,
            POSITION_REASON_CLIENT=0,
            POSITION_REASON_MOBILE=1,
            POSITION_REASON_WEB=2,
            POSITION_REASON_EXPERT=3,
        )
        self.account = SimpleNamespace(login=123, server="FTMO-Demo", currency="EUR", trade_mode=0,
                                       margin_mode=2, balance=20000., equity=20010., margin=20.,
                                       margin_free=19990.)
        self.position = SimpleNamespace(ticket=2**60+33, identifier=2**60+44, magic=0, reason=1,
                                        type=0, symbol="XAUUSD", volume=.1, price_open=2300.,
                                        price_current=2301., sl=2290., tp=2325., profit=10., swap=-.2,
                                        time=1700000000, time_msc=1700000000123)
        self.mt.terminal_info = Mock(return_value=SimpleNamespace(connected=True))
        self.mt.account_info = Mock(return_value=self.account)
        self.mt.positions_get = Mock(return_value=(self.position,))
        self.market_lock = threading.RLock()
        self.reader = ManualPositionsReader(self.mt, self.market_lock)

    def test_hedging_manual_provenance_requires_mt5_reason_and_zero_magic(self):
        result = self.reader.read()
        self.assertEqual(result["account"]["mode"], "HEDGING")
        self.assertEqual(result["positions"][0]["provenance"], "MANUAL")
        self.assertEqual(result["positions"][0]["owner"], "NOT_PAPER_BOT")
        self.assertEqual(result["positions"][0]["ticket"], str(2**60+33))
        self.assertEqual(result["positions"][0]["identifier"], str(2**60+44))
        self.assertEqual(result["positions"][0]["quoteFreshness"], "UNVERIFIED")

    def test_nonzero_magic_or_unrecognized_reason_is_never_called_manual(self):
        self.position.magic = 123456
        self.assertEqual(provenance(self.mt, self.position, "HEDGING"), "UNCONFIRMED")
        self.position.magic = 0
        self.position.reason = 99
        self.assertEqual(provenance(self.mt, self.position, "HEDGING"), "UNCONFIRMED")

    def test_external_expert_is_separate_from_manual_positions(self):
        self.position.magic = 123
        self.position.reason = self.mt.POSITION_REASON_EXPERT
        self.assertEqual(provenance(self.mt, self.position, "HEDGING"), "EXTERNAL_AUTOMATION")

    def test_netting_never_claims_independent_manual_provenance(self):
        self.account.margin_mode = self.mt.ACCOUNT_MARGIN_MODE_RETAIL_NETTING
        self.mt.account_info = Mock(side_effect=[self.account, self.account])
        result = self.reader.read()
        self.assertEqual(result["account"]["mode"], "NETTING")
        self.assertEqual(result["positions"][0]["provenance"], "NETTING_AGGREGATE")

    def test_exchange_is_presented_as_netting(self):
        account = SimpleNamespace(margin_mode=self.mt.ACCOUNT_MARGIN_MODE_EXCHANGE)
        self.assertEqual(account_mode(self.mt, account), "NETTING")

    def test_unknown_mode_or_missing_constants_is_not_guessed(self):
        self.assertEqual(account_mode(self.mt, SimpleNamespace(margin_mode=77)), "UNKNOWN")
        self.assertEqual(account_mode(SimpleNamespace(), SimpleNamespace(margin_mode=2)), "UNKNOWN")
        self.assertEqual(account_mode(self.mt, SimpleNamespace()), "UNKNOWN")

    def test_reader_never_initializes_connects_or_sends_broker_orders(self):
        result = self.reader.read()
        self.assertTrue(result["readOnly"])
        self.assertFalse(result["liveEnabled"])
        for name in ("initialize", "order_send", "order_check", "positions_modify", "position_close"):
            self.assertFalse(hasattr(self.mt, name))
        self.mt.positions_get.assert_called_once_with()

    def test_account_change_during_read_discards_all_positions(self):
        changed = SimpleNamespace(**vars(self.account))
        changed.login = 456
        self.mt.account_info = Mock(side_effect=[self.account, changed])
        result = self.reader.read()
        self.assertEqual(result["status"], "ACCOUNT_CHANGED")
        self.assertEqual(result["positions"], [])
        self.assertIsNone(result["account"])

    def test_failed_mt5_read_does_not_report_zero_positions(self):
        self.mt.positions_get.return_value = None
        result = self.reader.read()
        self.assertFalse(result["available"])
        self.assertEqual(result["status"], "UNAVAILABLE")
        self.assertEqual(result["positions"], [])

    def test_terminal_disconnect_does_not_modify_positions_or_claim_empty(self):
        self.mt.terminal_info.return_value = SimpleNamespace(connected=False)
        result = self.reader.read()
        self.assertEqual(result["status"], "DISCONNECTED")
        self.assertFalse(result["available"])
        self.mt.positions_get.assert_not_called()

    def test_contention_defers_read_without_waiting_or_burdening_v85(self):
        acquired, release = threading.Event(), threading.Event()

        def hold_market_lock():
            with self.market_lock:
                acquired.set()
                release.wait()

        holder = threading.Thread(target=hold_market_lock)
        holder.start()
        try:
            self.assertTrue(acquired.wait(2), "Le thread fixture n'a pas acquis le verrou")
            result = self.reader.read()
            self.assertEqual(result["status"], "BUSY")
            self.mt.positions_get.assert_not_called()
        finally:
            release.set()
            holder.join(timeout=2)
        self.assertFalse(holder.is_alive())

    def test_poll_is_throttled_to_five_seconds(self):
        with patch("manual_positions.time.time", return_value=100.):
            first = self.reader.read()
        self.assertTrue(first["available"])
        with patch("manual_positions.time.time", return_value=102.):
            second = self.reader.read()
        self.mt.positions_get.assert_called_once_with()
        self.assertEqual(second["checkedAt"], first["checkedAt"])
        with patch("manual_positions.time.time", return_value=106.):
            third = self.reader.read()
        self.assertTrue(third["available"])
        self.assertEqual(self.mt.positions_get.call_count, 2)
        self.assertEqual(third["checkedAt"], 106.)

    def test_exposure_risk_is_explicitly_incomplete_and_manual_is_excluded_from_paper(self):
        result = exposure_review(self.account, [self.position])
        self.assertFalse(result["liveAllowed"])
        self.assertFalse(result["riskComplete"])
        self.assertIsNone(result["riskAtStops"])
        self.assertFalse(result["pendingOrdersChecked"])
        self.assertFalse(result["paperIncluded"])

    def test_missing_stop_count_is_visible_but_never_claimed_full_risk(self):
        self.position.sl = 0
        result = exposure_review(self.account, [self.position])
        self.assertEqual(result["missingStops"], 1)
        self.assertFalse(result["riskComplete"])
        self.assertIsNone(result["riskAtStops"])

    def test_invalid_numbers_are_not_serialized_as_valid_account_metrics(self):
        self.account.equity = float("nan")
        result = exposure_review(self.account, [])
        self.assertIsNone(result["equity"])

    def test_invalid_ticket_refuses_position_identity(self):
        self.position.ticket = None
        with self.assertRaises(ValueError):
            serialize(self.mt, self.account, self.position, "HEDGING")

    def test_identifier_isolation_in_paper_dashboard_code(self):
        from pathlib import Path
        root = Path(__file__).resolve().parents[1]
        source = (root/"components/monitor/ManualPositionsPanel.tsx").read_text(encoding="utf-8")
        self.assertIn('queryKey: ["mt5-manual-positions-v87"]', source)
        self.assertIn('p.provenance === "MANUAL"', source)
        self.assertIn('NETTING_AGGREGATE', (root/"lib/manual-positions.ts").read_text(encoding="utf-8"))
        self.assertIn('liveEnabled: z.literal(false)', (root/"lib/manual-positions.ts").read_text(encoding="utf-8"))

    def paper_bot(self):
        bot = PaperTrial.__new__(PaperTrial)
        bot.mt5, bot.market_lock, bot.lock = self.mt, self.market_lock, threading.RLock()
        bot.challenge = SimpleNamespace(lock=threading.RLock(), verifying=False,
                                        state={"running": False, "position": None})
        bot.storage_fault = None
        bot.worker = {"status": "MONITORING", "heartbeat": 1801., "cause": None}
        bot.state = new_state()
        bot.state.update(running=True, trial=True, monitoringBlocked=False, quoteWaiting=False,
                         lastObserved=1799., lastSignal=900)
        bot.durable = deepcopy(bot.state)
        bot.connected, bot.feed = False, None
        bot.save, bot.frames, bot.snapshot = Mock(), Mock(), Mock(return_value={})
        bot.thread = Mock()
        bot.thread.is_alive.return_value = True
        self.mt.TIMEFRAME_M15 = 15
        self.mt.copy_rates_from_pos = Mock(return_value=[{"time": 900}])
        bot.bases = {"XAUUSD": SimpleNamespace(bars=lambda raw: raw)}
        self.broker_before = deepcopy(vars(self.position))
        self.account_before = deepcopy(vars(self.account))
        self.challenge_before = deepcopy(bot.challenge.state)
        self.mt.positions_get.reset_mock()
        for method in ("order_send", "order_check", "positions_modify", "position_close"):
            setattr(self.mt, method, Mock(side_effect=AssertionError("Acces broker interdit au PAPER")))
        return bot

    def feed(self, timestamp=1801., bid=2000.):
        return {"time": timestamp, "fxTime": timestamp, "bid": bid, "ask": bid+.2,
                "spread": .2, "fx": 1.1, "timeBasis": {"encoding": "UTC"},
                "contract": {"size": 100., "minLot": .01, "step": .01, "maxLot": 100.}}

    def assert_manual_untouched(self, bot):
        self.assertEqual(vars(self.position), self.broker_before)
        self.assertEqual(vars(self.account), self.account_before)
        self.assertEqual(bot.challenge.state, self.challenge_before)
        self.mt.positions_get.assert_not_called()
        for method in ("order_send", "order_check", "positions_modify", "position_close"):
            getattr(self.mt, method).assert_not_called()
        self.assertEqual(bot.state["mode"], "PAPER")
        self.assertIs(bot.state["liveEnabled"], False)

    def open_paper_position(self, bot):
        feed = self.feed()
        bot.market = Mock(return_value=feed)
        # This isolation test supplies an out-of-window calendar; the anti-gap suite tests its provenance.
        policy = {"checkedAt": 1801., "entriesAllowed": True, "closeDue": False, "marketOpen": True,
                  "weeklyClose": 100000., "reopen": 200000., "expiresAt": 300000.,
                  "evidenceSha256": "fixture", "sourceURL": "https://ftmo.com/", "status": "OPEN", "reason": "Fixture"}
        with patch("paper_trial.time.time", return_value=1801.), patch("paper_trial.market_protection", return_value=policy), patch("paper_trial.frozen_signal",
                   return_value=(1, 10., SimpleNamespace(value=1800*1_000_000_000))):
            bot.cycle()
        self.assertIsNotNone(bot.state["position"])
        self.assertLessEqual(bot.state["position"]["riskEUR"], 100.)
        self.assertEqual(len(bot.state["trades"]), 0)
        self.assertAlmostEqual(bot.state["balance"], 20000.-bot.state["position"]["entryCommissionEUR"])
        self.assert_manual_untouched(bot)

    def test_real_paper_open_and_monitor_preserve_manual_trade_and_one_bot_limit(self):
        bot = self.paper_bot()
        self.open_paper_position(bot)
        position = deepcopy(bot.state["position"])
        bot.market.return_value = self.feed(1802., 2001.)
        with patch("paper_trial.time.time", return_value=1802.), patch("paper_trial.frozen_signal") as signal:
            bot.cycle()
        signal.assert_not_called()
        self.assertEqual(bot.state["position"], position)
        self.assertEqual(len(bot.state["cashEvents"]), 1)
        self.assertEqual(bot.worker["status"], "MONITORING")
        self.assert_manual_untouched(bot)

    def test_real_paper_sl_and_tp_close_only_virtual_position(self):
        for bid, reason in ((2026., "TP"), (1989., "SL")):
            with self.subTest(reason=reason):
                bot = self.paper_bot()
                self.open_paper_position(bot)
                bot.market.return_value = self.feed(1802., bid)
                with patch("paper_trial.time.time", return_value=1802.):
                    bot.cycle()
                self.assertIsNone(bot.state["position"])
                self.assertEqual(len(bot.state["trades"]), 1)
                self.assertEqual(bot.state["trades"][0]["reason"], reason)
                self.assertEqual(len(bot.state["cashEvents"]), 2)
                self.assert_manual_untouched(bot)

    def test_real_paper_pause_start_and_resume_preserve_manual_position(self):
        bot = self.paper_bot()
        self.open_paper_position(bot)
        position = deepcopy(bot.state["position"])
        bot.pause()
        self.assertFalse(bot.state["running"])
        self.assert_manual_untouched(bot)
        bot.market.return_value = self.feed(1803., 2001.)
        with patch("paper_trial.time.time", return_value=1803.):
            bot.start()
            bot.cycle()
        self.assertTrue(bot.state["running"])
        self.assertEqual(bot.state["position"], position)
        self.assertEqual(len(bot.state["trades"]), 0)
        self.assert_manual_untouched(bot)

    def test_real_paper_stale_wait_and_fresh_recovery_preserve_manual_trade(self):
        bot = self.paper_bot()
        self.open_paper_position(bot)
        position = deepcopy(bot.state["position"])
        bot.market.side_effect = StaleQuoteError("EURUSD", 15.7)
        with patch("paper_trial.time.time", return_value=1802.):
            bot.cycle()
        self.assertTrue(bot.state["quoteWaiting"])
        self.assertEqual(bot.worker["status"], "WAITING_QUOTES")
        self.assertEqual(bot.state["position"], position)
        self.assert_manual_untouched(bot)
        bot.market.side_effect = None
        bot.market.return_value = self.feed(1803., 2001.)
        with patch("paper_trial.time.time", return_value=1803.):
            bot.cycle()
        self.assertFalse(bot.state["quoteWaiting"])
        self.assertEqual(bot.worker["status"], "MONITORING")
        self.assertEqual(len(bot.state["trades"]), 0)
        self.assert_manual_untouched(bot)

    def test_real_paper_gap_safe_stop_and_explicit_resume_leave_manual_trade_intact(self):
        bot = self.paper_bot()
        self.open_paper_position(bot)
        position = deepcopy(bot.state["position"])
        bot.market.return_value = self.feed(1820., 2001.)
        with patch("paper_trial.time.time", return_value=1820.):
            bot.cycle()
        self.assertEqual(bot.worker["status"], "SAFE_STOP")
        self.assertFalse(bot.state["running"])
        self.assertEqual(bot.state["position"], position)
        self.assertEqual(len(bot.state["trades"]), 0)
        self.assert_manual_untouched(bot)
        with patch("paper_trial.time.time", return_value=1820.):
            bot.start()
            bot.cycle()
        self.assertTrue(bot.state["running"])
        self.assertEqual(bot.state["position"], position)
        self.assert_manual_untouched(bot)

    def test_real_paper_permanent_error_safe_stops_without_touching_manual_trade(self):
        bot = self.paper_bot()
        self.open_paper_position(bot)
        position = deepcopy(bot.state["position"])
        bot.market.side_effect = ValueError("Convention horaire invalide : fixture")
        with patch("paper_trial.time.time", return_value=1802.):
            bot.cycle()
        self.assertEqual(bot.worker["status"], "SAFE_STOP")
        self.assertFalse(bot.state["running"])
        self.assertFalse(bot.state["quoteWaiting"])
        self.assertEqual(bot.state["position"], position)
        self.assertEqual(bot.state["trades"], [])
        self.assert_manual_untouched(bot)

    def test_netting_warns_instead_of_claiming_manual_position_independence(self):
        self.account.margin_mode = self.mt.ACCOUNT_MARGIN_MODE_RETAIL_NETTING
        self.mt.account_info = Mock(side_effect=[self.account, self.account])
        result = self.reader.read()
        self.assertEqual(result["positions"][0]["provenance"], "NETTING_AGGREGATE")
        self.assertEqual(result["positions"][0]["owner"], "NOT_PAPER_BOT")
        self.assertFalse(result["exposure"]["liveAllowed"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
