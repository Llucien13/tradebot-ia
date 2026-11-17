import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("paper_monitor_observer.py")
SPEC = importlib.util.spec_from_file_location("paper_monitor_observer", MODULE_PATH)
OBSERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OBSERVER)


def register(**overrides):
    state = {
        "version": 1,
        "mode": "PAPER",
        "liveEnabled": False,
        "trial": True,
        "running": False,
        "monitoringBlocked": True,
        "verifiedContinuous": False,
        "balance": 20_000.0,
        "equity": 20_000.0,
        "trades": [],
        "position": None,
        "curve": [{"time": 1_800_000_000, "equity": 20_000.0}],
        "quoteWaiting": False,
        "antiGap": {"marketOpen": True},
    }
    state.update(overrides)
    return state


class ReadOnlyObserverTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "essai.json"
        self.original_register = OBSERVER.REGISTER
        OBSERVER.REGISTER = self.path

    def tearDown(self):
        OBSERVER.REGISTER = self.original_register
        self.temp.cleanup()

    def write(self, state):
        self.path.write_text(json.dumps(state), encoding="utf-8")

    def test_reads_paper_snapshot_without_clearing_safe_stop_or_live_off(self):
        self.write(register())
        before = self.path.read_bytes()

        snapshot = OBSERVER.read_snapshot(now=1_800_000_100)

        self.assertEqual(snapshot["status"], "SAFE_STOP")
        self.assertFalse(snapshot["liveEnabled"])
        self.assertTrue(snapshot["readOnly"])
        self.assertFalse(snapshot["fresh"])
        self.assertEqual(snapshot["health"]["mt5"], "UNKNOWN")
        self.assertFalse(snapshot["health"]["worker"]["alive"])
        self.assertEqual(self.path.read_bytes(), before)

    def test_rejects_live_and_non_trial_registers(self):
        for changes in ({"liveEnabled": True}, {"trial": False}):
            with self.subTest(changes=changes):
                self.write(register(**changes))
                with self.assertRaises(OBSERVER.ObserverError):
                    OBSERVER.read_snapshot()

    def test_journal_preserves_closed_and_open_trade_identity(self):
        closed = {
            "phase": 1, "signalTime": 1_800_000_000, "entryTime": 1_800_000_010,
            "entry": 4000.0, "side": 1, "lots": 0.1, "sl": 3990.0, "tp": 4025.0,
            "riskEUR": 100.0, "exitTime": 1_800_000_100, "exit": 4025.0,
            "pnl": 200.0, "reason": "TP",
        }
        open_trade = {
            "phase": 1, "signalTime": 1_800_000_200, "entryTime": 1_800_000_210,
            "entry": 4010.0, "side": -1, "lots": 0.1, "sl": 4020.0, "tp": 3985.0,
            "riskEUR": 100.0,
        }
        self.write(register(trades=[closed], position=open_trade))
        before = self.path.read_bytes()

        page = OBSERVER.read_journal("start=0&limit=100&offset=0")
        snapshot = OBSERVER.read_snapshot(now=1_800_000_300)

        self.assertEqual(page["total"], 2)
        self.assertEqual(page["items"][0]["trade"]["entryTime"], open_trade["entryTime"])
        self.assertTrue(page["items"][0]["needsReview"])
        self.assertEqual(snapshot["metrics"]["count"], 1)
        self.assertEqual(snapshot["metrics"]["realized"], 200.0)
        self.assertIsNone(snapshot["position"]["floatingEUR"])
        self.assertTrue(snapshot["position"]["needsReview"])
        self.assertEqual(self.path.read_bytes(), before)

    def test_rejects_invalid_pagination(self):
        self.write(register())
        with self.assertRaises(OBSERVER.ObserverError):
            OBSERVER.read_journal("start=0&limit=101&offset=0")


if __name__ == "__main__":
    unittest.main()
