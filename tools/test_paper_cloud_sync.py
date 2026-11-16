import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("paper_cloud_sync.py")
SPEC = importlib.util.spec_from_file_location("paper_cloud_sync", MODULE_PATH)
SYNC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SYNC)


def source_snapshot():
    return {
        "ready": True,
        "version": 86,
        "mode": "PAPER",
        "liveEnabled": False,
        "readOnly": True,
        "observedAt": 1_800_000_000.0,
        "fresh": True,
        "status": "RUNNING",
        "floatingEUR": None,
        "position": None,
        "metrics": {
            "initial": 20000,
            "balance": 20000,
            "realized": 0,
            "count": 0,
            "wins": 0,
            "losses": 0,
            "neutral": 0,
            "winRate": None,
            "daily": [{"day": "private", "pnl": 99}],
        },
        "health": {
            "mt5": "UNKNOWN",
            "worker": {"status": "STOPPED", "alive": False, "heartbeat": None, "cause": "private"},
            "storageFault": None,
            "error": "private",
        },
        "quote": {"bid": 999999},
        "notifications": {"secret": "not exported"},
    }


class CloudSnapshotTests(unittest.TestCase):
    def test_only_read_only_paper_fields_are_exported(self):
        result = SYNC.cloud_snapshot(source_snapshot())
        self.assertEqual(result["mode"], "PAPER")
        self.assertIs(result["liveEnabled"], False)
        self.assertNotIn("quote", result)
        self.assertNotIn("notifications", result)
        self.assertNotIn("error", result["health"])
        self.assertNotIn("cause", result["health"]["worker"])

    def test_rejects_non_paper_or_live_enabled_sources(self):
        for field, value in (("mode", "LIVE"), ("liveEnabled", True), ("version", 85)):
            source = source_snapshot()
            source[field] = value
            with self.subTest(field=field), self.assertRaises(SYNC.SyncError):
                SYNC.cloud_snapshot(source)

    def test_cloud_requires_https_and_local_bridge_is_pinned_to_loopback(self):
        for value in ("http://example.test", "https://user:pass@example.test"):
            with self.subTest(value=value), self.assertRaises(SYNC.SyncError):
                SYNC.https_base(value, "cloud")
        for value in ("http://0.0.0.0:8765", "http://192.168.1.2:8765"):
            with self.subTest(value=value), self.assertRaises(SYNC.SyncError):
                SYNC.local_base(value)

    def test_rejects_invalid_position_and_capital(self):
        source = source_snapshot()
        source["metrics"]["initial"] = 45000
        with self.assertRaises(SYNC.SyncError):
            SYNC.cloud_snapshot(source)

        source = source_snapshot()
        source["position"] = {"instrument": "EURUSD"}
        with self.assertRaises(SYNC.SyncError):
            SYNC.cloud_snapshot(source)


if __name__ == "__main__":
    unittest.main()
