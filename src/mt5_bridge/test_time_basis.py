import unittest
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from time_basis import TimeBasis, validate_time_basis


def stamp(year, month, day=15, hour=12, minute=0, second=2):
    return datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc).timestamp()


def tick(raw):
    return SimpleNamespace(time=int(raw), time_msc=round(raw*1000))


class TimeBasisTests(unittest.TestCase):
    # Synthetic timezone fixture only; not a claim about FTMO's annual DST rule.
    zone = ZoneInfo("Europe/Helsinki")

    def test_utc_is_unchanged(self):
        now = stamp(2026, 10)
        self.assertEqual(TimeBasis().tick(tick(now-2), "XAUUSD", now), now-2)

    def test_server_wall_uses_offset_at_each_date(self):
        basis = TimeBasis("SERVER_WALL", self.zone)
        winter, summer = stamp(2026, 1), stamp(2026, 7)
        for now, offset in [(winter, 7200), (summer, 10800)]:
            self.assertEqual(basis.tick(tick(now+offset-2), "XAUUSD", now), now-2)
        self.assertEqual(basis.bars([winter+7200, summer+10800], stamp(2026, 12)), [winter, summer])

    def test_old_and_future_never_become_fresh(self):
        basis = TimeBasis("SERVER_WALL", self.zone)
        for month, offset in [(1, 7200), (7, 10800), (10, 10800)]:
            now = stamp(2026, month)
            for age in [15.01, 16, 60, 3600, 10800, -.001, -5.01, -6, -3600]:
                with self.subTest(month=month, age=age), self.assertRaises(ValueError):
                    basis.tick(tick(now+offset-age), "XAUUSD", now)
            for age in [0, 15]:
                self.assertEqual(basis.tick(tick(now+offset-age), "EURUSD", now), now-age)

    def test_no_rule_or_proof_means_no_compensation(self):
        now = stamp(2026, 10)
        with self.assertRaises(ValueError):
            TimeBasis().tick(tick(now+10800), "XAUUSD", now)
        with self.assertRaises(ValueError):
            TimeBasis("SERVER_WALL")

    def test_dst_fold_and_gap_are_rejected(self):
        basis = TimeBasis("SERVER_WALL", self.zone)
        for month, day in [(3, 29), (10, 25)]:
            with self.assertRaisesRegex(ValueError, "ambigue ou inexistante"):
                basis.normalize(stamp(2026, month, day, 3, 30), stamp(2026, 12))

    def test_bars_reject_future_and_nonchronological(self):
        now = stamp(2026, 10)
        for rows in [[now+6], [now, now], [now, now-1]]:
            with self.assertRaises(ValueError):
                TimeBasis().bars(rows, now)

    def test_inconsistent_units_still_rejected(self):
        with self.assertRaises(ValueError):
            TimeBasis().tick(SimpleNamespace(time=1000, time_msc=1001000), "XAUUSD", 1000)

    def fixture(self, encoding="SERVER_WALL", offset=None, month=10):
        now = stamp(2026, month, 20 if month == 10 else 2)
        offset = (10800 if month == 10 else 7200) if offset is None else offset
        raw = now-1+(offset if encoding == "SERVER_WALL" else 0)
        entries = [{"symbol": name, "time": int(raw), "time_msc": int(raw*1000), "m15Open": int(raw//900)*900}
                   for name in ["XAUUSD", "EURUSD"]]
        proof = {"schemaVersion": 2, "server": "FTMO-Demo", "login": 123, "tester": False,
                 "timeGMT": now, "timeTradeServer": now+offset, "timeCurrent": now+offset,
                 "encoding": encoding, "ticks": entries,
                 "confirmedPolicy": {"confirmed": True, "ianaZone": "Europe/Helsinki", "source": "synthetic test fixture; NOT a FTMO policy"}}
        account = SimpleNamespace(server="FTMO-Demo", login=123, trade_mode=0)
        mt5 = SimpleNamespace(ACCOUNT_TRADE_MODE_DEMO=0, TIMEFRAME_M15=15,
                              symbol_select=lambda *_: True, symbol_info_tick=lambda _: tick(raw),
                              copy_rates_from_pos=lambda *_: [{"time": int(raw//900)*900}])
        return proof, mt5, account, now

    def test_native_proof_enables_only_matching_basis(self):
        for encoding in ["UTC", "SERVER_WALL"]:
            proof, mt5, account, now = self.fixture(encoding)
            basis = validate_time_basis(proof, mt5, account, now)
            self.assertEqual(basis.encoding, encoding)
            with self.assertRaises(ValueError):
                basis.normalize(now, now+121)

    def test_auto_identifies_encoding_from_independent_native_clocks(self):
        for encoding in ["UTC", "SERVER_WALL"]:
            proof, mt5, account, now = self.fixture(encoding)
            proof["encoding"] = "AUTO"
            self.assertEqual(validate_time_basis(proof, mt5, account, now).encoding, encoding)

    def test_reported_gmt_plus_two_values_keep_xau_future_and_fx_fresh(self):
        now = 1793651074.850
        basis = TimeBasis("SERVER_WALL", timezone(timedelta(hours=2)))
        xau = tick(now + 7200.256)
        eur = tick(now + 7198.161)
        with self.assertRaisesRegex(ValueError, "age signe=-0.256 s"):
            basis.tick(xau, "XAUUSD", now)
        later = now + 1
        xau_utc = basis.normalize(xau.time_msc/1000, later)
        eur_utc = basis.normalize(eur.time_msc/1000, later)
        self.assertAlmostEqual(later-xau_utc, 0.744, places=3)
        self.assertAlmostEqual(later-eur_utc, 2.839, places=3)

    def test_proof_tolerance_only_allows_same_captured_tick_by_under_half_second(self):
        now = 1793651074.850
        basis = TimeBasis("SERVER_WALL", timezone(timedelta(hours=2)))
        basis.capture_gmt = now
        basis.native_raw = now + 7200 - .2
        basis.native_normalized = now - .2
        raw_native = SimpleNamespace(time=int(basis.native_raw), time_msc=round(basis.native_raw*1000))
        self.assertAlmostEqual(basis.tick_against_capture(raw_native, "XAUUSD", now), basis.native_normalized, places=5)
        fresher_but_future = SimpleNamespace(time=int(now+7200+.1), time_msc=round((now+7200+.1)*1000))
        with self.assertRaisesRegex(ValueError, "identique au releve"):
            basis.tick_against_capture(fresher_but_future, "XAUUSD", now)
        too_far_future = SimpleNamespace(time=int(basis.native_raw+.501), time_msc=round((basis.native_raw+.501)*1000))
        with self.assertRaisesRegex(ValueError, "identique au releve"):
            basis.tick_against_capture(too_far_future, "XAUUSD", now)

    def test_ftmo_gmt_plus_two_server_wall_ticks_and_m15_are_normalized(self):
        native_gmt = stamp(2026, 11, 2, 12, 0, 0)
        now = native_gmt + 1
        ages = {"XAUUSD": 0.256, "EURUSD": 2.161}
        entries = []
        raw_ticks = {}
        for symbol, age in ages.items():
            raw = native_gmt + 7200 - age
            raw_ticks[symbol] = tick(raw)
            entries.append({"symbol": symbol, "time": int(raw), "time_msc": round(raw*1000),
                            "m15Open": int(raw//900)*900})
        proof = {"schemaVersion": 2, "server": "FTMO-Demo", "login": 123, "tester": False,
                 "timeGMT": native_gmt, "timeTradeServer": native_gmt+7200, "timeCurrent": native_gmt+7200,
                 "encoding": "AUTO", "ticks": entries,
                 "confirmedPolicy": {"confirmed": False, "ianaZone": "", "source": ""}}
        account = SimpleNamespace(server="FTMO-Demo", login=123, trade_mode=0)
        mt5 = SimpleNamespace(ACCOUNT_TRADE_MODE_DEMO=0, TIMEFRAME_M15=15,
                              symbol_select=lambda *_: True,
                              symbol_info_tick=lambda symbol: raw_ticks[symbol],
                              copy_rates_from_pos=lambda symbol, *_: [{"time": entries[0 if symbol == "XAUUSD" else 1]["m15Open"]}])

        basis = validate_time_basis(proof, mt5, account, now)
        self.assertEqual(basis.encoding, "SERVER_WALL")
        for symbol, age in ages.items():
            normalized = basis.tick(raw_ticks[symbol], symbol, now)
            self.assertAlmostEqual(now-normalized, age+1, places=3)
            raw_open = int(raw_ticks[symbol].time//900)*900
            normalized_open = basis.bars([raw_open], now)[0]
            self.assertEqual(normalized_open, int(normalized//900)*900)

    def test_auto_does_not_accept_old_native_ticks_as_a_timezone(self):
        proof, mt5, account, now = self.fixture()
        proof["encoding"] = "AUTO"
        for entry in proof["ticks"]:
            entry["time"] -= 60
            entry["time_msc"] -= 60000
        with self.assertRaises(ValueError):
            validate_time_basis(proof, mt5, account, now)

    def test_proof_wrong_account_stale_future_tester_and_rule_rejected(self):
        proof, mt5, account, now = self.fixture()
        changes = [{"login": 456}, {"server": "Other"}, {"timeGMT": now-121}, {"timeGMT": now+1},
                   {"tester": True}, {"schemaVersion": 1}, {"ticks": []}, {"encoding": "UNKNOWN"},
                   {"confirmedPolicy": {"confirmed": False}},
                   {"confirmedPolicy": {"confirmed": True, "ianaZone": "UTC", "source": "fixture"}}]
        for change in changes:
            candidate = deepcopy(proof); candidate.update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_time_basis(candidate, mt5, account, now)

    def test_bad_ticks_and_bars_do_not_validate_proof(self):
        proof, mt5, account, now = self.fixture()
        mt5.symbol_info_tick = lambda _: tick(now+10800-60)
        with self.assertRaises(ValueError):
            validate_time_basis(proof, mt5, account, now)
        proof, mt5, account, now = self.fixture()
        mt5.copy_rates_from_pos = lambda *_: [{"time": now-2}]
        with self.assertRaises(ValueError):
            validate_time_basis(proof, mt5, account, now)


if __name__ == "__main__":
    unittest.main()
