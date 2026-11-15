"""Targeted engine calendar tests; no terminal, worker, order or replay."""
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace as NS
from zoneinfo import ZoneInfo

from server_clock import ServerClock, confirmed_server_clock, WINTER_START, WINTER_END
from time_basis import validate_time_basis
from preparation_evidence_v76 import fee_evidence


def stamp(text):
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc).timestamp()


class ServerClockTests(unittest.TestCase):
    def setUp(self):
        self.now = stamp("2026-11-03T12:00:02")
        self.proof = {"schemaVersion": 2, "tester": False, "server": "FTMO-Demo", "login": 123,
                      "timeGMT": self.now, "timeTradeServer": self.now + 7200,
                      "timeCurrent": self.now + 7200, "encoding": "AUTO",
                      "confirmedPolicy": {"confirmed": False}, "ticks": []}
        self.clock = confirmed_server_clock(self.proof, self.now)

    def test_official_winter_rollover_is_22_utc_not_prague_midnight(self):
        now = stamp("2026-11-03T22:30:00")
        self.assertEqual(self.clock.last_midnight(now), stamp("2026-11-03T22:00:00"))
        from_zone = datetime.fromtimestamp(now, ZoneInfo("Europe/Prague"))
        self.assertEqual(from_zone.date().isoformat(), "2026-11-03")
        self.assertEqual(datetime.fromtimestamp(now, self.clock.zone).date().isoformat(), "2026-11-04")

    def test_native_clock_contradiction_is_never_forced(self):
        self.proof["timeTradeServer"] += 3600
        with self.assertRaisesRegex(ValueError, "contraire"):
            confirmed_server_clock(self.proof, self.now)

    def test_no_annual_transition_is_invented(self):
        for now in (WINTER_START - 1, WINTER_END, stamp("2027-03-14T12:00:00")):
            with self.assertRaises(ValueError):
                confirmed_server_clock(self.proof, now)
        with self.assertRaises(ValueError):
            self.clock.offset(WINTER_END)

    def test_rollover_event_is_exact_and_charged_once(self):
        after = stamp("2026-11-03T22:00:00")
        until = stamp("2026-11-05T22:00:00")
        events = list(self.clock.rollovers(after, until))
        self.assertEqual(events, [(stamp("2026-11-04T22:00:00"), 2), (until, 3)])
        self.assertEqual(list(self.clock.rollovers(until, until)), [])

    def test_dst_calendar_handles_25_hour_day_without_86400_steps(self):
        # Synthetic declared zone; not a claim that FTMO follows Prague DST.
        clock = ServerClock(ZoneInfo("Europe/Prague"), "synthetic test only")
        after = stamp("2026-10-24T22:00:00")
        until = stamp("2026-10-25T23:00:00")
        self.assertEqual(clock.last_midnight(until), until)
        self.assertEqual(list(clock.rollovers(after, until)), [(until, 6)])
        self.assertEqual(until - after, 25 * 3600)

    def test_dst_calendar_handles_23_hour_day(self):
        clock = ServerClock(ZoneInfo("Europe/Prague"), "synthetic test only")
        after = stamp("2026-03-28T23:00:00")
        until = stamp("2026-03-29T22:00:00")
        self.assertEqual(list(clock.rollovers(after, until)), [(until, 6)])
        self.assertEqual(until - after, 23 * 3600)

    def native_fixture(self):
        raw = self.now + 7200 - 1
        tick = NS(time=int(raw), time_msc=int(raw * 1000))
        self.proof["ticks"] = [{"symbol": name, "time": tick.time, "time_msc": tick.time_msc,
                                "m15Open": int(raw // 900) * 900} for name in ("XAUUSD", "EURUSD")]
        account = NS(server="FTMO-Demo", login=123, trade_mode=0, currency="EUR")
        mt = NS(ACCOUNT_TRADE_MODE_DEMO=0, TIMEFRAME_M15=15, SYMBOL_CALC_MODE_CFD=2,
                symbol_select=lambda *_: True, symbol_info_tick=lambda _: tick,
                copy_rates_from_pos=lambda *_: [{"time": int(raw // 900) * 900}])
        return mt, account

    def test_native_server_wall_converts_only_after_measurements_pass(self):
        mt, account = self.native_fixture()
        basis = validate_time_basis(self.proof, mt, account, self.now)
        self.assertEqual(basis.encoding, "SERVER_WALL")
        self.assertEqual(basis.tick(mt.symbol_info_tick("XAUUSD"), "XAUUSD", self.now), self.now - 1)
        with self.assertRaises(ValueError):
            basis.bars([stamp("2026-10-20T12:00:00")], self.now)

    def test_expired_proof_and_wrong_account_remain_blocked(self):
        mt, account = self.native_fixture()
        with self.assertRaisesRegex(ValueError, "expire"):
            validate_time_basis(self.proof, mt, account, self.now + 121)
        account.login = 999
        with self.assertRaisesRegex(ValueError, "autre compte"):
            validate_time_basis(self.proof, mt, account, self.now)

    def test_swaps_and_hour_are_derived_from_native_validated_specs(self):
        mt, account = self.native_fixture()
        basis = validate_time_basis(self.proof, mt, account, self.now)
        mt.symbol_info = lambda _: NS(swap_mode=1, swap_long=-12.5, swap_short=3., swap_rollover3days=3,
                                      point=.01, trade_contract_size=100., trade_calc_mode=2,
                                      currency_base="XAU", currency_profit="USD", currency_margin="USD")
        fees = fee_evidence(mt, account, basis, self.now, "EURUSD")
        self.assertEqual(fees["status"], "VERIFIED")
        self.assertEqual(fees["swapHourUTC"], 22)
        self.assertEqual(fees["swapLongUSD"], -12.5)
        self.assertEqual(fees["swapShortUSD"], 3.)
        self.assertFalse(fees["appliedToLedger"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
