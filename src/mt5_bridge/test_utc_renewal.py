"""Renewal fixtures are synthetic, not evidence of FTMO's timezone policy."""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import test_time_basis as fixtures
from time_basis import load_time_basis, validate_time_basis


class UTCRenewalTests(unittest.TestCase):
    @staticmethod
    def fixture(encoding="SERVER_WALL"):
        return fixtures.TimeBasisTests().fixture(encoding)

    def test_expiry_cannot_be_extended_by_fresh_python_tick(self):
        proof, mt, account, now = self.fixture("UTC")
        mt.symbol_info_tick = lambda _: fixtures.tick(now + 121)
        with self.assertRaisesRegex(ValueError, "expire"):
            validate_time_basis(proof, mt, account, now + 121)

    def test_valid_new_native_capture_renews_expiration(self):
        proof, mt, account, now = self.fixture("UTC")
        old = validate_time_basis(proof, mt, account, now)
        delta = 150
        for key in ("timeGMT", "timeCurrent", "timeTradeServer"):
            proof[key] += delta
        for item in proof["ticks"]:
            item["time"] += delta
            item["time_msc"] += delta * 1000
            item["m15Open"] = int(item["time"] // 900) * 900
        raw = proof["ticks"][0]["time"]
        mt.symbol_info_tick = lambda _: fixtures.tick(raw)
        mt.copy_rates_from_pos = lambda *_: [{"time": int(raw // 900) * 900}]
        renewed = validate_time_basis(proof, mt, account, now + delta)
        self.assertEqual(renewed.valid_until, old.valid_until + delta)
        with self.assertRaises(ValueError):
            old.tick(fixtures.tick(raw), "XAUUSD", now + delta)

    def test_renewal_does_not_accept_unconfirmed_dst_rule(self):
        proof, mt, account, now = self.fixture()
        proof["confirmedPolicy"]["confirmed"] = False
        with self.assertRaises(ValueError):
            validate_time_basis(proof, mt, account, now)

    def test_native_file_revalidated_and_revocation_not_cached(self):
        proof, mt, account, now = self.fixture("UTC")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "MQL5" / "Files"
            root.mkdir(parents=True)
            file = root / "tradebot-clock-proof.json"
            terminal = SimpleNamespace(data_path=directory)
            file.write_text(json.dumps(proof), encoding="utf-8")
            self.assertEqual(load_time_basis(mt, terminal, account, now).encoding, "UTC")
            file.write_text("{partial", encoding="utf-8")
            with self.assertRaises(ValueError):
                load_time_basis(mt, terminal, account, now)

    def test_renewal_never_relaxes_fifteen_second_freshness(self):
        proof, mt, account, now = self.fixture("UTC")
        for raw in (now - 15.001, now + .001):
            mt.symbol_info_tick = lambda _, value=raw: fixtures.tick(value)
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                validate_time_basis(proof, mt, account, now)


if __name__ == "__main__":
    unittest.main()
