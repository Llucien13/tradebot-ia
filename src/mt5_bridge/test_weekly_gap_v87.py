"""V87 weekly-gap policy tests. UTC schedules and quotes are local fixtures only."""
import hashlib
import json
import tempfile
import threading
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from paper_storage import PaperStorage
from paper_trial import PaperTrial, new_state
from weekly_gap import market_protection


def epoch(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


class WeeklyGapPolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.doc = self.root / "official-hours.pdf"
        self.doc.write_bytes(b"fixture: documented official hours, UTC/DST and exceptions")
        self.schedule = self.root / "schedule.json"
        self.close = epoch("2026-11-06T21:00:00Z")
        self.reopen = epoch("2026-11-08T22:00:00Z")
        self.expires = epoch("2026-11-09T00:00:00Z")
        self.identity = {"server": "FTMO-Demo", "login": "123"}
        self.write_schedule()

    def tearDown(self):
        self.temp.cleanup()

    def write_schedule(self, **updates):
        data = {"schemaVersion": 1, "symbol": "XAUUSD", "server": "FTMO-Demo", "login": "123",
                "verifiedAtUTC": "2026-11-01T00:00:00Z", "expiresAtUTC": "2026-11-09T00:00:00Z",
                "evidence": {"sourceURL": "https://ftmo.com/", "verifiedBy": "reviewer fixture",
                             "exceptionsChecked": True, "utcAndDSTChecked": True,
                             "file": str(self.doc), "sha256": hashlib.sha256(self.doc.read_bytes()).hexdigest()},
                "sessions": [{"openUTC": "2026-11-02T00:00:00Z", "weeklyCloseUTC": "2026-11-06T21:00:00Z",
                              "reopenUTC": "2026-11-08T22:00:00Z"}], "exceptions": []}
        data.update(updates)
        self.schedule.write_text(json.dumps(data), encoding="utf-8")

    def policy(self, now, identity=None):
        return market_protection(now, self.identity if identity is None else identity, self.schedule)

    def test_new_entry_is_blocked_at_and_inside_last_60_minutes(self):
        for seconds in (3600, 3599, 900):
            with self.subTest(seconds=seconds):
                result = self.policy(self.close-seconds)
                self.assertFalse(result["entriesAllowed"])
                self.assertEqual(result["status"], "ENTRY_BLOCKED" if seconds > 900 else "EXIT_DUE")

    def test_entry_allowed_one_second_before_sixty_minute_window(self):
        result = self.policy(self.close-3601)
        self.assertTrue(result["entriesAllowed"])
        self.assertEqual(result["status"], "OPEN")

    def test_exit_due_at_and_inside_last_fifteen_minutes_only(self):
        for seconds in (900, 899, 1):
            with self.subTest(seconds=seconds):
                result = self.policy(self.close-seconds)
                self.assertTrue(result["closeDue"])
                self.assertEqual(result["status"], "EXIT_DUE")
        self.assertFalse(self.policy(self.close-901)["closeDue"])

    def test_close_boundary_never_claims_market_open_or_fabricates_schedule(self):
        result = self.policy(self.close)
        self.assertFalse(result["entriesAllowed"])
        self.assertFalse(result["closeDue"])
        self.assertFalse(result["marketOpen"])
        self.assertEqual(result["status"], "MARKET_CLOSED")

    def test_non_utc_schedule_timestamps_are_rejected(self):
        data = json.loads(self.schedule.read_text(encoding="utf-8"))
        data["sessions"][0]["weeklyCloseUTC"] = "2026-11-06T21:00:00+01:00"
        self.write_schedule(**data)
        self.assertEqual(self.policy(self.close-100)["status"], "UNKNOWN")

    def test_document_tampering_invalidates_schedule(self):
        self.doc.write_bytes(b"changed fixture document")
        result = self.policy(self.close-100)
        self.assertEqual(result["status"], "UNKNOWN")
        self.assertFalse(result["entriesAllowed"])
        self.assertIsNone(result["weeklyClose"])

    def test_dst_uses_attested_utc_deadline_not_a_fixed_friday_hour(self):
        data = json.loads(self.schedule.read_text(encoding="utf-8"))
        data["sessions"][0]["weeklyCloseUTC"] = "2026-11-06T22:00:00Z"
        self.write_schedule(**data)
        moved_close = self.close+3600
        self.assertTrue(self.policy(moved_close-3601)["entriesAllowed"])
        self.assertFalse(self.policy(moved_close-3600)["entriesAllowed"])
        self.assertTrue(self.policy(moved_close-900)["closeDue"])
        self.assertEqual(self.policy(moved_close-900)["weeklyClose"], moved_close)

    def test_unknown_or_invalid_hours_fail_closed(self):
        self.schedule.unlink()
        result = self.policy(self.close-100)
        self.assertEqual(result["status"], "UNKNOWN")
        self.assertFalse(result["entriesAllowed"])
        self.write_schedule()
        self.assertEqual(self.policy(self.close-100, {"server": "Other", "login": "123"})["status"], "UNKNOWN")
        self.write_schedule(sessions=[])
        self.assertEqual(self.policy(self.close-100)["status"], "UNKNOWN")

    def test_expired_evidence_or_unchecked_exception_dst_fails_closed(self):
        self.assertEqual(self.policy(self.expires)["status"], "UNKNOWN")
        evidence = json.loads(self.schedule.read_text(encoding="utf-8"))["evidence"]
        evidence["utcAndDSTChecked"] = False
        self.write_schedule(evidence=evidence)
        self.assertEqual(self.policy(self.close-100)["status"], "UNKNOWN")

    def test_attested_exception_closes_market_and_prevents_new_entries_before_it(self):
        data = json.loads(self.schedule.read_text(encoding="utf-8"))
        data["exceptions"] = [{"closedFromUTC": "2026-11-06T20:00:00Z", "closedUntilUTC": "2026-11-06T20:30:00Z"}]
        self.write_schedule(**data)
        before = self.policy(epoch("2026-11-06T19:00:00Z"))
        closed = self.policy(epoch("2026-11-06T20:01:00Z"))
        self.assertFalse(before["entriesAllowed"])
        self.assertEqual(before["weeklyClose"], epoch("2026-11-06T20:00:00Z"))
        self.assertEqual(before["status"], "ENTRY_BLOCKED")
        self.assertFalse(closed["marketOpen"])
        self.assertEqual(closed["status"], "MARKET_CLOSED")

    def make_bot(self, position=True):
        bot = PaperTrial.__new__(PaperTrial)
        bot.lock = threading.RLock()
        bot.market_lock = threading.RLock()
        bot.mt5 = SimpleNamespace(TIMEFRAME_M15=15, copy_rates_from_pos=Mock(return_value=[]))
        bot.challenge = None
        bot.state = new_state()
        bot.state.update(running=True, trial=True, monitoringBlocked=False, quoteWaiting=False,
                         lastObserved=self.close-501, lastSignal=self.close-900)
        bot.worker = {"status": "MONITORING", "heartbeat": self.close-500., "cause": None}
        bot.storage_fault = None
        bot.connected = True
        bot.feed = None
        bot.save = Mock()
        bot.frames = Mock()
        bot.bases = {"XAUUSD": SimpleNamespace(bars=lambda raw: raw)}
        bot.feed_time = self.close-500
        bot.thread = Mock()
        bot.thread.is_alive.return_value = True
        if position:
            bot.state["position"] = {"phase": 1, "signalTime": self.close-900, "entryTime": self.close-800,
                                     "entry": 2000., "side": 1, "lots": .1, "contract": 100.,
                                     "sl": 1990., "tp": 2025., "riskEUR": 100., "entryFX": 1.1,
                                     "entryCommissionEUR": .3, "timeBasis": {"encoding": "UTC"}}
        return bot

    def fresh_feed(self, now):
        return {"time": now, "fxTime": now, "bid": 2010., "ask": 2010.4, "spread": .4,
                "fx": 1.1, "timeBasis": {"encoding": "UTC"},
                "contract": {"size": 100., "minLot": .01, "step": .01, "maxLot": 10.}}

    def exit_policy(self, now):
        return {"checkedAt": now, "entriesAllowed": False, "closeDue": True, "marketOpen": True,
                "weeklyClose": self.close, "reopen": self.reopen, "expiresAt": self.expires,
                "evidenceSha256": "fixture", "sourceURL": "https://ftmo.com/",
                "status": "EXIT_DUE", "reason": "15 min"}

    def test_successful_preventive_exit_uses_realistic_quote_and_paper_costs(self):
        bot = self.make_bot()
        bot.state.update(commissionUSD=2., slippageUSD=.5)
        feed = self.fresh_feed(self.close-500)
        original = bot.state["position"].copy()
        with patch("paper_trial.time.time", return_value=self.close-500), patch(
                "paper_trial.market_protection", side_effect=lambda *_: self.exit_policy(self.close-500)):
            bot.observe(feed)
        trade = bot.state["trades"][-1]
        self.assertEqual(trade["reason"], "WEEKLY_CLOSE")
        self.assertAlmostEqual(trade["exit"], feed["bid"]-.5)
        gross = (trade["exit"]-original["entry"])*original["contract"]*original["lots"]
        self.assertAlmostEqual(trade["grossUSD"], gross)
        self.assertAlmostEqual(trade["pnl"], (gross-2*.1)/feed["fx"]-original["entryCommissionEUR"])
        self.assertIsNone(bot.state["position"])
        self.assertEqual(bot.state["antiGap"]["status"], "CLOSED")

    def test_cycle_closes_at_deadline_without_waiting_for_a_new_m15_signal(self):
        bot = self.make_bot()
        feed = self.fresh_feed(self.close-500)
        bot.market = Mock(return_value=feed)
        now = self.close-500
        with patch("paper_trial.time.time", return_value=now), patch(
                "paper_trial.market_protection", side_effect=lambda *_: self.exit_policy(now)), patch(
                "paper_trial.frozen_signal", side_effect=AssertionError("Aucune nouvelle bougie/signal nécessaire")):
            bot.cycle()
        self.assertIsNone(bot.state["position"])
        self.assertEqual(bot.state["trades"][-1]["reason"], "WEEKLY_CLOSE")
        self.assertEqual(bot.worker["status"], "MONITORING")
        bot.save.assert_called_once()

    def test_unknown_schedule_blocks_entry_without_evaluating_strategy(self):
        bot = self.make_bot(position=False)
        now = self.close-4000
        bot.market = Mock(return_value=self.fresh_feed(now))
        unknown = {"checkedAt": now, "entriesAllowed": False, "closeDue": False, "marketOpen": None,
                   "weeklyClose": None, "reopen": None, "expiresAt": None, "evidenceSha256": None,
                   "sourceURL": None, "status": "UNKNOWN", "reason": "Hours unavailable"}
        with patch("paper_trial.time.time", return_value=now), patch(
                "paper_trial.market_protection", return_value=unknown), patch(
                "paper_trial.frozen_signal", side_effect=AssertionError("Unknown schedule must block entry")):
            bot.cycle()
        self.assertIsNone(bot.state["position"])
        self.assertEqual(bot.state["antiGap"]["status"], "UNKNOWN")
        self.assertEqual(bot.worker["status"], "MONITORING")

    def test_invalid_or_stale_close_quote_keeps_position_and_records_alert(self):
        bot = self.make_bot()
        feed = self.fresh_feed(self.close-500)
        feed["time"] -= 16
        feed["fxTime"] -= 16
        bot.market = Mock(return_value=feed)
        before = bot.state["position"].copy()
        now = self.close-500
        with patch("paper_trial.time.time", return_value=now), patch(
                "paper_trial.market_protection", side_effect=lambda *_: self.exit_policy(now)):
            bot.cycle()
        self.assertEqual(bot.state["position"], before)
        self.assertEqual(bot.state["trades"], [])
        self.assertTrue(bot.state["gapEvents"])
        self.assertEqual(bot.state["gapEvents"][-1]["status"], "CLOSE_PENDING")
        self.assertIn("conservee sans sortie inventee", bot.state["gapEvents"][-1]["message"])
        self.assertEqual(bot.worker["status"], "WAITING_QUOTES")
        self.assertEqual(bot.save.call_count, 1)

    def test_repeated_failed_closes_do_not_accumulate_reason_or_notifications(self):
        from paper_time import StaleQuoteError
        bot = self.make_bot()
        now = self.close-500
        bot.market = Mock(side_effect=StaleQuoteError("XAUUSD", 16))
        with patch("paper_trial.time.time", return_value=now), patch(
                "paper_trial.market_protection", side_effect=lambda *_: self.exit_policy(now)):
            bot.cycle()
            reason = bot.state["antiGap"]["reason"]
            events = list(bot.state["gapEvents"])
            for _ in range(5):
                bot.cycle()
        self.assertEqual(bot.state["antiGap"]["reason"], reason)
        self.assertEqual(bot.state["gapEvents"], events)
        self.assertIsNotNone(bot.state["position"])
        self.assertEqual(bot.state["trades"], [])

    def test_short_exit_uses_ask_plus_adverse_slippage(self):
        bot = self.make_bot()
        bot.state["position"]["side"] = -1
        bot.state["slippageUSD"] = .5
        now = self.close-500
        bot.market = Mock(return_value=self.fresh_feed(now))
        with patch("paper_trial.time.time", return_value=now), patch(
                "paper_trial.market_protection", side_effect=lambda *_: self.exit_policy(now)):
            bot.cycle()
        self.assertEqual(bot.state["trades"][-1]["reason"], "WEEKLY_CLOSE")
        self.assertAlmostEqual(bot.state["trades"][-1]["exit"], 2010.4+.5)

    def test_invalid_prices_cannot_create_weekly_exit(self):
        for field, value in (("bid", float("nan")), ("ask", float("inf")), ("fx", 0.), ("ask", 2009.)):
            with self.subTest(field=field, value=value):
                bot = self.make_bot()
                now = self.close-500
                feed = self.fresh_feed(now)
                feed[field] = value
                bot.market = Mock(return_value=feed)
                original = bot.state["position"].copy()
                with patch("paper_trial.time.time", return_value=now), patch(
                        "paper_trial.market_protection", side_effect=lambda *_: self.exit_policy(now)):
                    bot.cycle()
                self.assertEqual(bot.state["position"], original)
                self.assertEqual(bot.state["trades"], [])
                self.assertEqual(bot.state["antiGap"]["status"], "CLOSE_PENDING")
                self.assertEqual(bot.worker["status"], "SAFE_STOP")

    def test_after_close_no_quote_is_requested_and_position_is_retained(self):
        bot = self.make_bot()
        bot.market = Mock(side_effect=AssertionError("No quote execution after close"))
        policy = self.exit_policy(self.close)
        policy.update(status="MARKET_CLOSED", marketOpen=False, closeDue=False)
        with patch("paper_trial.time.time", return_value=self.close), patch(
                "paper_trial.market_protection", side_effect=lambda *_: dict(policy)):
            bot.cycle()
        bot.market.assert_not_called()
        self.assertIsNotNone(bot.state["position"])
        self.assertEqual(bot.state["trades"], [])
        self.assertEqual(bot.state["antiGap"]["status"], "CLOSE_PENDING")
        self.assertEqual(bot.worker["status"], "WAITING_MARKET")

    def test_manual_mt5_positions_are_not_read_or_modified_by_paper_exit(self):
        bot = self.make_bot()
        manual = SimpleNamespace(ticket=922337203685477000, sl=1990., tp=2100., volume=.2)
        before = vars(manual).copy()
        bot.mt5.positions_get = Mock(side_effect=AssertionError("PAPER cannot enumerate manual positions"))
        bot.mt5.order_send = Mock(side_effect=AssertionError("LIVE OFF"))
        feed = self.fresh_feed(self.close-500)
        now = self.close-500
        bot.market = Mock(return_value=feed)
        with patch("paper_trial.time.time", return_value=now), patch(
                "paper_trial.market_protection", side_effect=lambda *_: self.exit_policy(now)):
            bot.cycle()
        self.assertEqual(vars(manual), before)
        bot.mt5.positions_get.assert_not_called()
        bot.mt5.order_send.assert_not_called()

    def test_restart_keeps_paper_position_and_requires_explicit_resume(self):
        bot = self.make_bot()
        position = bot.state["position"].copy()
        bot.state.update(running=False, monitoringBlocked=True)
        bot.connected, bot.feed = False, None
        with patch("paper_trial.time.time", return_value=self.close-500), patch(
                "paper_trial.market_protection", return_value=self.exit_policy(self.close-500)):
            bot.cycle()
        self.assertEqual(bot.state["position"], position)
        self.assertEqual(bot.state["trades"], [])
        self.assertFalse(bot.state["running"])

    def test_persistent_registry_restart_preserves_pending_position_and_gap_state(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/"paper.json"
            storage = PaperStorage(path)
            state = new_state()
            state["position"] = {"phase": 1, "signalTime": self.close-900, "entryTime": self.close-800,
                                  "entry": 2000., "side": 1, "lots": .1, "contract": 100.,
                                  "sl": 1990., "tp": 2025., "riskEUR": 100., "entryFX": 1.1,
                                  "entryCommissionEUR": .3, "timeBasis": {"encoding": "UTC"}}
            state["antiGap"] = self.exit_policy(self.close-500)
            state["running"] = False
            storage.commit(state)
            storage.close()
            reopened = PaperStorage(path)
            restored = reopened.load(new_state)
            self.assertEqual(restored["position"], state["position"])
            self.assertEqual(restored["antiGap"], state["antiGap"])
            reopened.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
