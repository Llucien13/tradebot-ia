import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

from quote_time import PARIS, clock_details, fresh_tick_timestamp, tick_timestamp


class QuoteTimeTests(unittest.TestCase):
    def tick(self, timestamp):
        return SimpleNamespace(time=int(timestamp), time_msc=round(timestamp * 1000))

    def test_seconds_and_milliseconds_describe_same_instant(self):
        self.assertEqual(tick_timestamp(self.tick(1760000000.125)), 1760000000.125)

    def test_missing_milliseconds_uses_seconds_without_offset(self):
        self.assertEqual(tick_timestamp(SimpleNamespace(time=1760000000, time_msc=0)), 1760000000)

    def test_inconsistent_units_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "incoherents"):
            tick_timestamp(SimpleNamespace(time=1760000000, time_msc=1760003600000))

    def test_freshness_boundaries(self):
        now = 1760000000.0
        for age in [0, 15, -5]:
            self.assertEqual(fresh_tick_timestamp(self.tick(now-age), "XAUUSD", now), now-age)
        for age in [15.001, -5.001, 3600, -3600]:
            with self.assertRaises(ValueError):
                fresh_tick_timestamp(self.tick(now-age), "XAUUSD", now)

    def test_paris_winter_and_summer_do_not_change_unix_age(self):
        for month, offset in [(1, 3600), (7, 7200)]:
            instant = datetime(2026, month, 15, 12, tzinfo=timezone.utc)
            paris = instant.astimezone(PARIS)
            self.assertEqual(paris.utcoffset().total_seconds(), offset)
            self.assertEqual(paris.timestamp(), instant.timestamp())
            self.assertEqual(fresh_tick_timestamp(self.tick(instant.timestamp()-2), "XAUUSD", instant.timestamp()), instant.timestamp()-2)

    def test_ftmo_three_hour_advance_is_not_automatically_compensated(self):
        now = datetime(2026, 10, 20, 12, tzinfo=timezone.utc).timestamp()
        for delta in [10800, 10800-20, 10800+20, -10800]:
            with self.subTest(delta=delta), self.assertRaises(ValueError):
                fresh_tick_timestamp(self.tick(now+delta), "XAUUSD", now)

    def test_old_quote_is_not_made_fresh_by_learning_an_offset(self):
        now = 1760000000.0
        for age in [16, 60, 3600, 10800, 86400]:
            with self.subTest(age=age), self.assertRaises(ValueError):
                fresh_tick_timestamp(self.tick(now-age), "EURUSD", now)

    def test_future_quotes_are_rejected_in_every_season(self):
        for month in [1, 3, 7, 10, 11, 12]:
            now = datetime(2026, month, 15, 12, tzinfo=timezone.utc).timestamp()
            for advance in [6, 7200, 10800]:
                with self.subTest(month=month, advance=advance), self.assertRaises(ValueError):
                    fresh_tick_timestamp(self.tick(now+advance), "XAUUSD", now)

    def test_dst_transition_does_not_change_age(self):
        for month, day in [(3, 29), (10, 25)]:
            before = datetime(2026, month, day, 0, 59, 59, tzinfo=timezone.utc).timestamp()
            after = before + 2
            self.assertEqual(fresh_tick_timestamp(self.tick(before), "EURUSD", after), before)

    def test_error_contains_evidence(self):
        now = 1760000000.0
        with self.assertRaises(ValueError) as result:
            fresh_tick_timestamp(self.tick(now-3600), "XAUUSD", now)
        for text in ["UTC=", "Europe/Paris=", "age signe=3600.000 s", "time_msc=", "15 s"]:
            self.assertIn(text, str(result.exception))
        self.assertIn("+00:00", clock_details(now, now))


if __name__ == "__main__":
    unittest.main()
