"""Isolated fixtures only; no terminal, network, orders or worker started."""
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import HTTPException
from mt5_availability import IPCGate, MT5IPCError, MarketPause, confirmed_pause
import test_paper_trial_waiting as waiting_fixtures


def paper_fixture():
    return waiting_fixtures.PaperTrialWaitingTests().service()


class AvailabilityTests(unittest.TestCase):
    def proof(self):
        return {"tester": False, "server": "FTMO-Demo", "login": 123, "timeGMT": 100000.,
                "tradeSessions": {s: {"complete": True, "day": 1, "intervals": [[0, 3600], [7200, 86400]]}
                                  for s in ("XAUUSD", "EURUSD")}}

    def test_native_server_session_pause_and_reopening(self):
        proof = self.proof()
        account = SimpleNamespace(server="FTMO-Demo", login=123)
        # Monday 01:30 server time; pause is supplied by MT5, not inferred from tick age.
        monday = 4*86400+5400
        proof["timeGMT"] = monday
        with patch("mt5_availability._read_native_proof", return_value=proof), patch(
                "mt5_availability.confirmed_server_clock", return_value=SimpleNamespace(offset=lambda _: 0)):
            self.assertEqual(confirmed_pause(SimpleNamespace(), account, monday), "XAUUSD")
            proof["timeGMT"] = monday+1800
            self.assertIsNone(confirmed_pause(SimpleNamespace(), account, monday+1800))

    def test_unknown_expired_or_wrong_account_is_not_normal_pause(self):
        proof = self.proof()
        account = SimpleNamespace(server="FTMO-Demo", login=456)
        with patch("mt5_availability._read_native_proof", return_value=proof):
            self.assertIsNone(confirmed_pause(SimpleNamespace(), account, 100000))
            account.login = 123
            self.assertIsNone(confirmed_pause(SimpleNamespace(), account, 100121))

    def test_ipc_timeout_retries_are_spaced_and_bounded(self):
        gate = IPCGate()
        with patch("mt5_availability.time.monotonic", return_value=100):
            with self.assertRaises(MT5IPCError):
                gate.failure((-10005, "IPC timeout"))
            with self.assertRaises(HTTPException):
                gate.check()
        for now in (115, 145):
            with patch("mt5_availability.time.monotonic", return_value=now):
                gate.check()
                with self.assertRaises(MT5IPCError):
                    gate.failure((-10005, "IPC timeout"))
        with patch("mt5_availability.time.monotonic", return_value=10000):
            with self.assertRaises(HTTPException):
                gate.check()
        self.assertEqual(gate.attempts, 3)

    def test_successful_connection_resets_gate_not_paper_safety(self):
        gate = IPCGate()
        with self.assertRaises(MT5IPCError):
            gate.failure((-10005, "IPC timeout"))
        gate.success()
        gate.check()
        self.assertEqual(gate.attempts, 0)

    def test_confirmed_pause_preserves_history_then_fresh_ticks_revalidate(self):
        bot = paper_fixture()
        bot.market = Mock(side_effect=[MarketPause("XAUUSD"),
                                      {"time": 110., "fxTime": 110.}])
        bot.observe = Mock()
        bot.cycle()
        self.assertEqual(bot.worker["status"], "WAITING_QUOTES")
        self.assertIn("MARCHE FERME", bot.state["quoteWaitReason"])
        self.assertEqual(bot.state["trades"], [])
        self.assertEqual(bot.state["lastObserved"], 100.)
        bot.cycle()
        bot.frames.assert_called_once()
        bot.observe.assert_called_once()
        self.assertEqual(bot.worker["status"], "MONITORING")

    def test_ipc_reconnect_success_never_clears_safe_stop(self):
        bot = paper_fixture()
        bot.market = Mock(side_effect=MT5IPCError("IPC -10005"))
        bot.connect = Mock(return_value=(object(), object()))
        bot.observe = Mock()
        with patch("paper_trial.time.monotonic", return_value=100):
            bot.cycle()
            bot.cycle()
        bot.connect.assert_not_called()
        with patch("paper_trial.time.monotonic", return_value=115):
            bot.cycle()
        bot.connect.assert_called_once()
        self.assertEqual(bot.worker["status"], "SAFE_STOP")
        self.assertFalse(bot.state["running"])
        bot.observe.assert_not_called()

    def test_ipc_failed_reconnections_stop_after_two_retries(self):
        bot = paper_fixture()
        bot.market = Mock(side_effect=MT5IPCError("IPC -10005"))
        bot.connect = Mock(side_effect=MT5IPCError("still unavailable"))
        with patch("paper_trial.time.monotonic", return_value=100):
            bot.cycle()
        for now in (115, 145, 200, 500):
            with patch("paper_trial.time.monotonic", return_value=now):
                bot.cycle()
        self.assertEqual(bot.connect.call_count, 2)
        self.assertTrue(bot.state["monitoringBlocked"])
        self.assertFalse(bot.state["running"])
        self.assertEqual(bot.state["trades"], [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
