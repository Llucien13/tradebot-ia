"""Synthetic failure tests only: no MT5, bot thread, replay or backtest."""
import json
import tempfile
import threading
import time
import unittest
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import HTTPException
from ftmo_service import FTMOService, new_state
from paper_storage import PaperStorage


class PaperSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "challenge.json"
        self.store = PaperStorage(self.path)
        self.addCleanup(self.store.close)
        self.state = new_state()
        self.store.commit(self.state)

    def service(self):
        s = FTMOService.__new__(FTMOService)
        s.state = deepcopy(self.state)
        s.durable = deepcopy(s.state)
        s.storage = self.store
        s.storage_fault = None
        s.worker = {"status": "STOPPED", "heartbeat": time.time(), "cause": None}
        s.thread = Mock()
        s.thread.is_alive.return_value = True
        s.report_file = self.path.with_name('verification.json')
        s.lock = threading.RLock()
        s.connected = False
        s.feed = None
        s.verifying = False
        return s

    def test_restore_capital_position_and_history_exactly(self):
        self.state.update(balance=19992.0, equity=19990.0, lastSignal=900,
                          position={"phase": 1, "signalTime": 900, "entry": 3000},
                          trades=[{"phase": 1, "signalTime": 0, "pnl": -8}],
                          cashEvents=[{"type": "ENTRY_COMMISSION", "amount": -8}],
                          curve=[{"time": 900, "equity": 19990}])
        self.store.commit(self.state)
        self.assertEqual(self.store.load(new_state), self.state)

    def test_crash_before_replace_restores_old_checkpoint(self):
        changed = deepcopy(self.state); changed["balance"] = 19000
        with patch("paper_storage.os.replace", side_effect=OSError("crash")):
            with self.assertRaises(OSError):
                self.store.commit(changed)
        self.assertEqual(self.store.load(new_state), self.state)

    def test_crash_after_replace_restores_new_checkpoint_once(self):
        self.state.update(position=None, balance=20010, lastSignal=900,
                          trades=[{"phase": 1, "signalTime": 900, "pnl": 10}],
                          cashEvents=[{"type": "EXIT_NET", "amount": 10}])
        self.store.commit(self.state)
        self.store.close()
        reopened = PaperStorage(self.path)
        self.addCleanup(reopened.close)
        for _ in range(2):
            self.assertEqual(reopened.load(new_state), self.state)
            self.assertEqual(len(reopened.load(new_state)["trades"]), 1)
        s = self.service()
        s.state = reopened.load(new_state)
        s.state["running"] = True
        s.observe({"time": 901})
        self.assertEqual(s.state["balance"], 20010)
        self.assertEqual(len(s.state["trades"]), 1)
        self.assertEqual(s.state["cashEvents"], self.state["cashEvents"])

    def test_corrupt_checkpoint_not_reset(self):
        self.path.write_text("{broken", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.store.load(new_state)
        self.assertEqual(self.path.read_text(encoding="utf-8"), "{broken")

    def test_read_permission_error_not_reset(self):
        with patch.object(Path, "open", side_effect=PermissionError("read denied")):
            with self.assertRaises(PermissionError):
                self.store.load(new_state)

    def test_interrupted_initial_commit_not_reset(self):
        self.path.unlink()
        self.path.with_suffix(".tmp").write_text("partial", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "interrompu"):
            self.store.load(new_state)

    def test_second_writer_rejected(self):
        with self.assertRaises(OSError):
            PaperStorage(self.path)

    def test_duplicate_closed_trade_rejected(self):
        self.state["trades"] = [{"phase": 1, "signalTime": 900}] * 2
        with self.assertRaisesRegex(ValueError, "dupliquee"):
            self.store.commit(self.state)

    def test_closed_trade_cannot_be_open_again(self):
        self.state["trades"] = [{"phase": 1, "signalTime": 900}]
        self.state["position"] = {"phase": 1, "signalTime": 900}
        with self.assertRaisesRegex(ValueError, "dupliquee"):
            self.store.commit(self.state)

    def test_nonfinite_capital_rejected(self):
        self.state["balance"] = float("nan")
        with self.assertRaises(ValueError):
            self.store.commit(self.state)

    def test_failed_start_checkpoint_rolls_back_and_latches(self):
        s = self.service()
        s.report = Mock(return_value={"status": "PASSED"})
        now = time.time()
        s.market = Mock(return_value={"timeBasis": {"encoding": "UTC"}, "time": now,
                                     "fees": {"swapLongUSD": -1., "swapShortUSD": 1., "swapHourUTC": 22}})
        s.frames = Mock(return_value={"m15": SimpleNamespace(index=[SimpleNamespace(value=int(now // 900) * 900 * 1_000_000_000)])})
        config = {key: self.state[key] for key in ("swapLongUSD", "swapShortUSD", "swapHourUTC", "commissionUSD", "slippageUSD")}
        with patch.object(self.store, "commit", side_effect=OSError("disk full")), \
             patch("ftmo_service.inspect_evidence", return_value={"verificationEvidence": "CORROBORATED_LEGACY_REPORT"}):
            with self.assertRaises(OSError):
                s.start(config)
        self.assertFalse(s.state["running"])
        self.assertIsNone(s.state["startedAt"])
        self.assertEqual(s.state["balance"], 20000)
        self.assertEqual(s.worker["status"], "SAFE_STOP")
        with self.assertRaises(RuntimeError):
            s.save()

    def test_start_never_substitutes_readiness_for_missing_history(self):
        s = self.service()
        s.report = Mock(return_value={"status": "NOT_RUN"})
        s.market = Mock()
        with self.assertRaises(HTTPException) as failure:
            s.start({"commissionUSD": 3., "slippageUSD": .05})
        self.assertIn("Preuve historique", failure.exception.detail)
        s.market.assert_not_called()
        self.assertFalse(s.state["running"])
        self.assertEqual(s.state["balance"], 20000)

    def test_start_refuses_dead_worker_without_market_access(self):
        s = self.service()
        s.thread.is_alive.return_value = False
        s.market = Mock()
        with self.assertRaises(HTTPException) as failure:
            s.start({"commissionUSD": 3., "slippageUSD": .05})
        self.assertIn("Worker/heartbeat", failure.exception.detail)
        s.market.assert_not_called()
        self.assertFalse(s.state["running"])

    def test_mocked_start_derives_costs_and_rejects_a_manual_mismatch(self):
        s = self.service()
        now = time.time()
        s.report = Mock(return_value={"status": "PASSED"})
        s.market = Mock(return_value={"time": now, "timeBasis": {"encoding": "UTC"},
                                     "fees": {"swapLongUSD": -1., "swapShortUSD": .5, "swapHourUTC": 22}})
        s.frames = Mock(return_value={"m15": SimpleNamespace(index=[SimpleNamespace(value=int(now // 900) * 900 * 1_000_000_000)])})
        s.save = Mock()
        s.snapshot = Mock(return_value={"synthetic": True})
        with patch("ftmo_service.inspect_evidence", return_value={"verificationEvidence": "CORROBORATED_LEGACY_REPORT"}):
            with self.assertRaises(HTTPException):
                s.start({"swapHourUTC": 21, "commissionUSD": 3., "slippageUSD": .05})
            self.assertFalse(s.state["running"])
            self.assertEqual(s.start({"commissionUSD": 3., "slippageUSD": .05}), {"synthetic": True})
        self.assertEqual(s.state["swapHourUTC"], 22)
        self.assertEqual(s.state["swapLongUSD"], -1.)
        self.assertEqual(s.state["balance"], 20000.)
        self.assertEqual(s.state["trades"], [])
        self.assertIsNone(s.state["position"])
        self.assertFalse(s.state["liveEnabled"])

    def test_fsync_failure_keeps_checkpoint(self):
        with patch("paper_storage.os.fsync", side_effect=OSError("fsync")):
            with self.assertRaises(OSError):
                self.store.commit(self.state)
        self.assertEqual(self.store.load(new_state), self.state)

    def test_expired_utc_holds_position_without_exit(self):
        s = self.service()
        s.state["position"] = {"phase": 1, "signalTime": 900, "entry": 3000}
        s.state["running"] = True
        s.market = Mock(side_effect=ValueError("UTC expired"))
        s.observe = Mock()
        position = deepcopy(s.state["position"])
        s.cycle()
        s.observe.assert_not_called()
        self.assertEqual(s.state["position"], position)
        self.assertEqual(s.state["trades"], [])
        self.assertTrue(s.state["monitoringBlocked"])
        self.assertFalse(s.state["running"])
        s.cycle()
        self.assertEqual(s.market.call_count, 1)

    def test_partial_observation_rolled_back(self):
        s = self.service(); s.state["running"] = True
        s.market = Mock(return_value={"time": 900, "fees": {"swapLongUSD": -1., "swapShortUSD": 1., "swapHourUTC": 22}})
        def broken(_):
            s.state["balance"] -= 10
            s.state["cashEvents"].append({"amount": -10})
            raise ValueError("invalid bars")
        s.observe = broken
        s.cycle()
        self.assertEqual(s.state["balance"], 20000)
        self.assertEqual(s.state["cashEvents"], [])
        self.assertFalse(s.state["running"])

    def test_worker_write_failure_does_not_escape_cycle(self):
        s = self.service(); s.state["running"] = True
        s.market = Mock(return_value={"time": 900, "fees": {"swapLongUSD": -1., "swapShortUSD": 1., "swapHourUTC": 22}})
        s.observe = Mock()
        with patch.object(self.store, "commit", side_effect=PermissionError("denied")):
            s.cycle()
        self.assertEqual(s.worker["status"], "SAFE_STOP")
        self.assertFalse(s.state["running"])
        self.assertIsNotNone(s.storage_fault)

    def test_write_open_failure_keeps_checkpoint(self):
        with patch.object(Path, "open", side_effect=PermissionError("write denied")):
            with self.assertRaises(PermissionError):
                self.store.commit(self.state)
        self.assertEqual(self.store.load(new_state), self.state)

    def test_restart_holds_position_without_starting_thread(self):
        self.state.update(running=True, balance=19997, equity=19990,
                          position={"phase": 1, "signalTime": 900, "entry": 3000},
                          lastQuote={"symbol": "XAUUSD"},
                          cashEvents=[{"type": "ENTRY_COMMISSION", "amount": -3}])
        self.store.commit(self.state)
        with patch.dict("os.environ", {"LOCALAPPDATA": self.temp.name}), \
             patch("ftmo_service.PaperStorage", return_value=self.store), \
             patch("ftmo_service.extract_reference"), \
             patch("ftmo_service.implementation_hash", return_value="fixture"):
            s = FTMOService(None, None, threading.RLock())
        self.assertFalse(s.thread.is_alive())
        self.assertFalse(s.state["running"])
        self.assertTrue(s.state["monitoringBlocked"])
        for key in ("balance", "equity", "position", "cashEvents", "trades", "lastSignal"):
            self.assertEqual(s.state[key], self.state[key])

    def test_report_read_failure_latches_safe_stop(self):
        s = self.service()
        s.report_file = self.path
        s.state["running"] = True
        with patch.object(Path, "read_text", side_effect=PermissionError("report denied")) as read:
            result = s.report()
        read.assert_called_once_with(encoding="utf-8")
        self.assertEqual(result["status"], "ERROR")
        self.assertFalse(s.state["running"])
        self.assertEqual(s.worker["status"], "SAFE_STOP")
        self.assertTrue(s.state["monitoringBlocked"])
        self.assertFalse(s.state["verifiedContinuous"])
        self.assertIn("report denied", s.storage_fault)
        self.assertEqual(s.worker["cause"], s.storage_fault)
        self.assertEqual(result["error"], s.state["error"])
        with self.assertRaisesRegex(RuntimeError, "Stockage verrouille"):
            s.save()
        s.market = Mock()
        s.observe = Mock()
        s.cycle()
        s.market.assert_not_called()
        s.observe.assert_not_called()
        self.assertEqual(s.worker["status"], "SAFE_STOP")
        self.assertFalse(s.state["running"])


if __name__ == "__main__":
    unittest.main()
