"""Targeted PAPER waiting/recovery tests; no live MT5, orders or replay."""
import threading
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock

from paper_trial import PaperTrial
from paper_time import StaleQuoteError, configured_paper_basis


class PaperTrialWaitingTests(unittest.TestCase):
    def service(self):
        trial = PaperTrial.__new__(PaperTrial)
        trial.lock = threading.RLock()
        trial.market_lock = threading.RLock()
        trial.storage_fault = None
        trial.stop_event = threading.Event()
        trial.worker = {"status": "MONITORING", "heartbeat": 0, "cause": None}
        trial.challenge = None
        trial.state = {"running": True, "monitoringBlocked": False, "quoteWaiting": False,
                       "quoteWaitReason": None, "quoteWaitAge": None, "error": "",
                       "position": None, "lastObserved": 100., "lastSignal": 0,
                       "interruptions": [], "trades": [], "equity": 20000., "balance": 20000.,
                       "curve": [], "status": "PHASE_1", "verifiedContinuous": True}
        trial.durable = trial.state.copy()
        trial.connected = False
        trial.feed = None
        trial.thread = Mock()
        trial.thread.is_alive.return_value = True
        trial.save = Mock()
        trial.frames = Mock()
        trial.snapshot = Mock(return_value={"state": trial.state, "worker": trial.worker})
        return trial

    def test_stale_quote_waits_without_observe_then_resumes_on_next_fresh_cycle(self):
        trial = self.service()
        stale = StaleQuoteError("EURUSD", 15.7)
        fresh = {"time": 200., "fxTime": 200., "timeBasis": {"encoding": "PER_SYMBOL"}}
        trial.market = Mock(side_effect=[stale, fresh])
        trial.observe = Mock()
        trial.cycle()
        self.assertTrue(trial.state["running"])
        self.assertTrue(trial.state["quoteWaiting"])
        self.assertEqual(trial.worker["status"], "WAITING_QUOTES")
        self.assertIn("15.700", trial.state["quoteWaitReason"])
        self.assertEqual(trial.state["quoteWaitAge"], 15.7)
        trial.observe.assert_not_called()
        trial.cycle()
        self.assertFalse(trial.state["quoteWaiting"])
        self.assertTrue(trial.state["running"])
        self.assertEqual(trial.worker["status"], "MONITORING")
        trial.observe.assert_called_once_with(fresh)

    def test_stale_cycle_does_not_mutate_signal_or_trade_state_and_saves_once(self):
        trial = self.service()
        trial.market = Mock(side_effect=StaleQuoteError("XAUUSD", 15.7))
        trial.observe = Mock()
        before = {key: trial.state[key] for key in ("balance", "equity", "lastSignal", "lastObserved", "trades", "curve")}
        trial.cycle()
        self.assertEqual({key: trial.state[key] for key in before}, before)
        trial.observe.assert_not_called()
        trial.save.assert_called_once()

    def test_future_quote_is_permanent_safe_stop_not_waiting(self):
        trial = self.service()
        trial.market = Mock(side_effect=ValueError("Tick EURUSD futur apres conversion GMT+2 : age signe=-0.2 s"))
        trial.observe = Mock()
        trial.cycle()
        self.assertFalse(trial.state["running"])
        self.assertFalse(trial.state["quoteWaiting"])
        self.assertTrue(trial.state["monitoringBlocked"])
        self.assertEqual(trial.worker["status"], "SAFE_STOP")
        trial.observe.assert_not_called()

    def test_permanent_configuration_error_still_latches_safe_stop(self):
        trial = self.service()
        trial.market = Mock(side_effect=ValueError("Heure serveur ambigue EURUSD"))
        trial.cycle()
        self.assertFalse(trial.state["running"])
        self.assertFalse(trial.state["quoteWaiting"])
        self.assertTrue(trial.state["monitoringBlocked"])
        self.assertIn("ambigue", trial.state["error"])

    def test_manual_stop_while_waiting_disables_automatic_retry(self):
        trial = self.service()
        trial.state.update(quoteWaiting=True, error="EURUSD trop ancien", quoteWaitReason="EURUSD trop ancien", quoteWaitAge=15.7)
        trial.pause()
        self.assertFalse(trial.state["running"])
        self.assertFalse(trial.state["quoteWaiting"])
        self.assertEqual(trial.worker["status"], "STOPPED")
        trial.market = Mock()
        trial.cycle()
        trial.market.assert_not_called()

    def test_permanent_error_after_waiting_clears_waiting_status(self):
        trial = self.service()
        trial.market = Mock(side_effect=[StaleQuoteError("EURUSD", 15.7), ValueError("Heure serveur ambigue")])
        trial.cycle()
        trial.cycle()
        self.assertFalse(trial.state["running"])
        self.assertFalse(trial.state["quoteWaiting"])
        self.assertIsNone(trial.state["quoteWaitReason"])
        self.assertIsNone(trial.state["quoteWaitAge"])
        self.assertEqual(trial.worker["status"], "SAFE_STOP")

    def test_start_with_stale_quote_waits_then_validates_frames_before_observe(self):
        trial = self.service()
        trial.state.update(running=False, startedAt=None, commissionUSD=0., slippageUSD=0., lastObserved=None)
        fresh = {"time": 1800., "fxTime": 1800., "timeBasis": {"encoding": "PER_SYMBOL"}}
        trial.market = Mock(side_effect=[StaleQuoteError("EURUSD", 15.7), fresh])
        trial.observe = Mock()
        trial.start()
        self.assertTrue(trial.state["running"])
        self.assertTrue(trial.state["quoteWaiting"])
        trial.frames.assert_not_called()
        trial.cycle()
        trial.frames.assert_called_once()
        trial.observe.assert_called_once_with(fresh)
        self.assertEqual(trial.state["lastSignal"], 1800)
        self.assertFalse(trial.state["quoteWaiting"])

    def test_invalid_frames_on_recovery_remain_blocking(self):
        trial = self.service()
        trial.market = Mock(side_effect=[StaleQuoteError("EURUSD", 15.7), {"time": 110., "fxTime": 110.}])
        trial.observe = Mock()
        trial.frames.side_effect = ValueError("Historique M15 courant non synchronise")
        trial.cycle()
        trial.cycle()
        trial.observe.assert_not_called()
        self.assertFalse(trial.state["running"])
        self.assertFalse(trial.state["quoteWaiting"])
        self.assertEqual(trial.worker["status"], "SAFE_STOP")

    def test_open_position_is_unchanged_while_waiting_and_gap_safety_is_preserved(self):
        trial = self.service()
        position = {"entry": 2000., "timeBasis": {"encoding": "PER_SYMBOL"}}
        trial.state["position"] = position.copy()
        trial.market = Mock(side_effect=[StaleQuoteError("EURUSD", 15.7),
                                        {"time": 200., "timeBasis": position["timeBasis"]}])
        trial.observe = Mock()
        trial.cycle()
        self.assertEqual(trial.state["position"], position)
        self.assertTrue(trial.state["running"])
        trial.cycle()
        trial.observe.assert_not_called()
        self.assertEqual(trial.state["position"], position)
        self.assertFalse(trial.state["quoteWaiting"])
        self.assertEqual(trial.worker["status"], "SAFE_STOP")
        self.assertIn("reprise explicite", trial.state["error"])

    def test_stale_recheck_rolls_back_observe_mutations(self):
        trial = self.service()
        trial.market = Mock(return_value={"time": 110., "fxTime": 110.})

        def observe(_feed):
            trial.state["balance"] -= 10
            trial.state["trades"].append({"entry": 2000.})
            raise StaleQuoteError("EURUSD", 15.7)

        trial.observe = observe
        trial.cycle()
        self.assertEqual(trial.state["balance"], 20000.)
        self.assertEqual(trial.state["trades"], [])
        self.assertEqual(trial.worker["status"], "WAITING_QUOTES")

    def test_repeated_wait_does_not_accumulate_events(self):
        trial = self.service()
        trial.market = Mock(side_effect=StaleQuoteError("EURUSD", 15.7))
        trial.observe = Mock()
        for _ in range(3):
            trial.cycle()
        self.assertEqual(trial.state["interruptions"], [])
        self.assertEqual(trial.state["trades"], [])
        trial.observe.assert_not_called()
        self.assertEqual(trial.worker["status"], "WAITING_QUOTES")

    def test_gmt_plus_two_15_point_7_seconds_is_typed_as_transient(self):
        now = datetime(2026, 11, 3, 12, tzinfo=timezone.utc).timestamp()
        # Raw value is exactly server-wall +7200, with a 15.7 s true tick age.
        raw = now+7200-15.7
        tick = SimpleNamespace(time=int(raw), time_msc=round(raw*1000))
        mt = SimpleNamespace(ACCOUNT_TRADE_MODE_DEMO=0)
        account = SimpleNamespace(trade_mode=0, server="FTMO-Demo")
        basis = configured_paper_basis(mt, account, now)
        with self.assertRaises(StaleQuoteError) as raised:
            basis.basis_for_tick(raw, now, "EURUSD").tick(tick, "EURUSD", now)
        self.assertEqual(raised.exception.symbol, "EURUSD")
        self.assertAlmostEqual(raised.exception.age, 15.7, places=3)


if __name__ == "__main__":
    unittest.main()
