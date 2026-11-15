"""V86 isolated unit/contract tests. Fixtures are NOT evidence from a real terminal."""
import ast
import asyncio
import csv
import io
import json
import os
import re
import tempfile
import threading
import unittest
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from monitor_metrics import metrics, trade_id
from monitor_store import DEFAULT_SETTINGS, MonitorStore
from monitor_telegram import deliver_one, send
from paper_monitor import PaperMonitor

ROOT = Path(__file__).resolve().parent
NOW = datetime(2026, 11, 6, 12, tzinfo=timezone.utc).timestamp()


def trade(index=1, pnl=None):
    item = {"phase": 1, "signalTime": NOW-900*index, "entryTime": NOW-900*index+1,
            "entry": 2000., "side": 1, "lots": .1, "sl": 1990., "tp": 2025.,
            "riskEUR": 100., "entryCommissionEUR": .3}
    if pnl is not None:
        item.update(exitTime=NOW-100*index, exit=2000.+pnl/10, pnl=pnl, reason="TP" if pnl > 0 else "SL", balance=20000.+pnl)
    return item


def snapshot(trades=None, position=None):
    state = {"mode": "PAPER", "liveEnabled": False, "trial": True,
             "balance": 20000., "equity": 20000., "position": position,
             "trades": trades or [], "curve": [], "running": True,
             "quoteWaiting": False, "monitoringBlocked": False, "verifiedContinuous": True,
             "error": "", "lastObserved": NOW, "lastQuote": {"time": NOW, "fxTime": NOW}}
    return {"state": state, "storageFault": None, "connected": True, "valuationFresh": True,
            "feed": {"time": NOW, "fxTime": NOW, "bid": 2001., "ask": 2001.2, "fx": 1.1},
            "worker": {"status": "MONITORING", "heartbeat": NOW, "alive": True, "cause": None}, "costModel": "Fixture only"}


class MetricTests(unittest.TestCase):
    def test_zero_trades_has_no_ratios_or_invented_curve(self):
        m = metrics(snapshot()["state"], NOW)
        self.assertEqual(m["realized"], 0)
        self.assertEqual(m["curve"], [])
        for name in ("winRate", "profitFactor", "averageR", "averageEUR", "drawdownEUR"):
            self.assertIsNone(m[name])

    def test_one_win_no_loss_profit_factor_is_infinite(self):
        m = metrics(snapshot([trade(pnl=250)])["state"], NOW)
        self.assertEqual(m["wins"], 1)
        self.assertEqual(m["winRate"], 100)
        self.assertTrue(m["profitFactorInfinite"])
        self.assertEqual(m["averageR"], 2.5)

    def test_multiple_trades_wins_losses_neutral_and_r(self):
        m = metrics(snapshot([trade(1, 250), trade(2, -100), trade(3, 0)])["state"], NOW)
        self.assertEqual((m["wins"], m["losses"], m["neutral"]), (1, 1, 1))
        self.assertAlmostEqual(m["winRate"], 100/3)
        self.assertEqual(m["profitFactor"], 2.5)
        self.assertEqual(m["averageWin"], 250)
        self.assertEqual(m["averageLoss"], -100)
        self.assertEqual(m["averageEUR"], 50)
        self.assertEqual(m["averageR"], .5)

    def test_missing_risk_is_excluded_from_r_not_pnl(self):
        t = trade(pnl=-10)
        t.pop("riskEUR")
        m = metrics(snapshot([t])["state"], NOW)
        self.assertEqual(m["realized"], -10)
        self.assertEqual(m["rCount"], 0)
        self.assertIsNone(m["averageR"])

    def test_recorded_drawdown_not_intrabar_estimate(self):
        state = snapshot()["state"]
        state["curve"] = [{"time": NOW-3, "equity": 20100}, {"time": NOW-2, "equity": 19800}, {"time": NOW-1, "equity": 20000}]
        m = metrics(state, NOW)
        self.assertEqual(m["drawdownEUR"], 300)
        self.assertAlmostEqual(m["drawdownPercent"], 300/20100*100)

    def test_periods_and_daily_use_paris_closure_day(self):
        now = datetime(2026, 11, 6, 0, 10, tzinfo=timezone.utc).timestamp()
        t = trade(pnl=25)
        t["exitTime"] = now-1800  # Previous UTC day, same Paris day.
        m = metrics(snapshot([t])["state"], now)
        self.assertEqual(m["periods"]["today"], 25)
        self.assertEqual(m["daily"][0]["day"], "2026-11-06")

    def test_curve_payload_is_bounded_without_changing_drawdown(self):
        state = snapshot()["state"]
        state["curve"] = [{"time": NOW+i, "equity": 20000+i%100} for i in range(10000)]
        m = metrics(state, NOW)
        self.assertLessEqual(len(m["curve"]), 800)
        self.assertEqual(m["drawdownEUR"], 99)
        self.assertEqual(m["curveSamples"], 10000)


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)/"monitor.sqlite3"
        self.store = MonitorStore(self.path)
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(lambda: self.store.close())

    def test_trade_identity_is_stable_after_closure(self):
        self.assertEqual(trade_id(trade()), trade_id(trade(pnl=250)))
        self.assertNotEqual(trade_id(trade(1)), trade_id(trade(2)))

    def test_restart_preserves_journal_and_deduplicates_events(self):
        s = snapshot([trade(pnl=250)])
        self.store.ingest(s, NOW)
        self.store.close()
        self.store = MonitorStore(self.path)
        self.store.ingest(s, NOW+3)
        self.assertEqual(self.store.journal(0, NOW+1, "all", 0, 30)["total"], 1)
        self.assertEqual(sum(e["kind"] == "close" for e in self.store.events()), 1)

    def test_open_then_closed_is_one_record_two_lifecycle_events(self):
        self.store.ingest(snapshot(position=trade()), NOW)
        self.store.ingest(snapshot([trade(pnl=250)]), NOW+3)
        self.assertEqual(self.store.journal(0, NOW+10, "all", 0, 30)["total"], 1)
        self.assertEqual(sum(e["trade_id"] is not None for e in self.store.events()), 2)

    def test_missing_open_position_is_never_fictitiously_closed(self):
        self.store.ingest(snapshot(position=trade()), NOW)
        self.store.ingest(snapshot(), NOW+10)
        row = self.store.journal(0, NOW+10, "open", 0, 30)["items"][0]
        self.assertTrue(row["needsReview"])
        self.assertNotIn("exit", row["trade"])
        self.assertNotIn("pnl", row["trade"])

    def test_waiting_tick_age_does_not_spam_technical_events(self):
        s = snapshot()
        s["state"].update(quoteWaiting=True, error="EURUSD ancien 15.7")
        self.store.ingest(s, NOW)
        count = len(self.store.events())
        s["state"]["error"] = "EURUSD ancien 18.7"
        self.store.ingest(s, NOW+3)
        self.assertEqual(len(self.store.events()), count)

    def test_baseline_import_does_not_notify_old_trades(self):
        self.store.configure({**DEFAULT_SETTINGS, "enabled": True})
        self.store.ingest(snapshot([trade(pnl=250)]), NOW)
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0], 0)

    def test_gap_protection_events_are_persisted_and_queued_once(self):
        self.store.configure({**DEFAULT_SETTINGS, "enabled": True, "safe": True})
        s = snapshot()
        s["state"]["gapEvents"] = [{"id": "gap:fixture-60", "time": NOW, "status": "ENTRY_BLOCKED",
                                     "message": "ANTI-GAP PAPER : entrées bloquées"}]
        self.store.ingest(s, NOW)
        self.store.ingest(s, NOW+3)
        row = self.store.db.execute("SELECT e.kind,o.status FROM events e JOIN outbox o ON e.id=o.id WHERE e.id='gap:fixture-60'").fetchone()
        self.assertEqual(tuple(row), ("safe", "PENDING"))
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM outbox WHERE id='gap:fixture-60'").fetchone()[0], 1)
        self.store.close()
        self.store = MonitorStore(self.path)
        self.store.ingest(s, NOW+6)
        self.assertEqual(sum(event["id"] == "gap:fixture-60" for event in self.store.events()), 1)
        self.assertEqual(self.store.db.execute("SELECT COUNT(*) FROM outbox WHERE id='gap:fixture-60'").fetchone()[0], 1)

    def test_waiting_market_is_visible_as_non_running_state(self):
        s = snapshot()
        s["worker"]["status"] = "WAITING_MARKET"
        s["worker"]["cause"] = "Market closed"
        self.assertEqual(self.store.ingest(s, NOW), "WAITING_MARKET")

    def test_result_filters_and_pagination(self):
        self.store.ingest(snapshot([trade(1, 250), trade(2, -100), trade(3, 0)]), NOW)
        self.assertEqual(self.store.journal(0, NOW, "win", 0, 10)["total"], 1)
        self.assertEqual(self.store.journal(0, NOW, "loss", 0, 10)["total"], 1)
        self.assertEqual(self.store.journal(0, NOW, "all", 1, 1)["offset"], 1)

    def test_nonpaper_or_live_source_is_refused(self):
        for mode, live in (("LIVE", False), ("PAPER", True)):
            s = snapshot()
            s["state"].update(mode=mode, liveEnabled=live)
            with self.assertRaises(ValueError):
                self.store.ingest(s, NOW)

    def test_csv_exports_real_values_and_neutralizes_formulas(self):
        from monitor_routes import register_monitor_routes
        routes = {}

        def route(path):
            def register(function):
                routes[path] = function
                return function
            return register

        t = trade(pnl=250)
        t["entryReason"] = '=HYPERLINK("unsafe")'
        self.store.ingest(snapshot([t]), NOW)
        app = SimpleNamespace(get=route, post=route)
        register_monitor_routes(app, lambda: SimpleNamespace(store=self.store))
        response = routes["/paper-monitor/export.csv"](0, NOW+1, "all")
        rows = list(csv.reader(io.StringIO(response.body.decode("utf-8-sig")), delimiter=";"))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[1][1], "XAUUSD")
        self.assertEqual(rows[1][13], "250")
        self.assertTrue(rows[1][-2].startswith("'="))

    def test_sender_disabled_has_no_network_call(self):
        sender = Mock()
        self.assertFalse(deliver_one(self.store, NOW, sender))
        sender.assert_not_called()

    def queue(self):
        self.store.configure({**DEFAULT_SETTINGS, "enabled": True})
        self.store.ingest(snapshot(), NOW)
        self.store.ingest(snapshot(position=trade()), NOW+1)

    @patch("monitor_telegram.credentials", return_value=("private", "123"))
    def test_notification_is_sent_once_across_retries(self, _credentials):
        self.queue()
        sender = Mock(return_value=("SENT", None, 0))
        self.assertTrue(deliver_one(self.store, NOW+2, sender))
        self.assertFalse(deliver_one(self.store, NOW+3, sender))
        sender.assert_called_once()

    @patch("monitor_telegram.credentials", return_value=("private", "123"))
    def test_rate_limit_is_retried_later(self, _credentials):
        self.queue()
        sender = Mock(side_effect=[("PENDING", "rate limit", 60), ("SENT", None, 0)])
        deliver_one(self.store, NOW+2, sender)
        self.assertFalse(deliver_one(self.store, NOW+3, sender))
        self.assertTrue(deliver_one(self.store, NOW+100, sender))
        self.assertEqual(sender.call_count, 2)

    @patch("monitor_telegram.credentials", return_value=("private", "123"))
    def test_uncertain_delivery_is_not_duplicated(self, _credentials):
        self.queue()
        sender = Mock(return_value=("UNCERTAIN", "network", 0))
        deliver_one(self.store, NOW+2, sender)
        self.assertFalse(deliver_one(self.store, NOW+10000, sender))
        sender.assert_called_once()

    def test_disable_cancels_pending_messages(self):
        self.queue()
        self.store.configure(DEFAULT_SETTINGS.copy())
        self.assertEqual(self.store.db.execute("SELECT status FROM outbox").fetchone()[0], "CANCELLED")

    def test_interrupted_send_becomes_uncertain_on_restart(self):
        self.queue()
        with self.store.db:
            self.store.db.execute("UPDATE outbox SET status='SENDING'")
        self.store.close()
        self.store = MonitorStore(self.path)
        self.assertEqual(self.store.db.execute("SELECT status FROM outbox").fetchone()[0], "UNCERTAIN")


class ObserverTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = snapshot(position=trade())
        self.trial = SimpleNamespace(lock=threading.RLock(), file=Path(self.temp.name)/"essai.json",
                                     snapshot=lambda: deepcopy(self.source), frame_counts={"m15": 4000})
        self.monitor = PaperMonitor(self.trial)
        self.addCleanup(self.monitor.store.close)

    def sample(self, now=NOW):
        with patch("paper_monitor.time.time", return_value=now):
            self.monitor.sample()
        return self.monitor.snapshot()

    def test_observer_has_no_engine_mutation_and_never_sends_orders(self):
        original = deepcopy(self.source)
        result = self.sample()
        self.assertEqual(self.source, original)
        self.assertIs(result["liveEnabled"], False)
        self.assertIs(result["readOnly"], True)
        self.assertEqual(result["position"]["id"], trade_id(trade()))
        # This fixture exposes NO MT5, save, observe, market, challenge, start or pause method.

    def test_fresh_observed_valuation_reports_recorded_equity_only(self):
        self.source["state"]["equity"] = 20010
        result = self.sample()
        self.assertTrue(result["fresh"])
        self.assertEqual(result["floatingEUR"], 10)
        self.assertAlmostEqual(result["position"]["netPositionEUR"], 9.7)

    def test_start_quote_without_matching_valuation_is_not_fresh(self):
        self.source["state"]["lastQuote"]["time"] = NOW-10
        self.assertFalse(self.sample()["fresh"])

    def test_stale_quote_hides_floating_pnl(self):
        result = self.sample(NOW+16)
        self.assertFalse(result["fresh"])
        self.assertIsNone(result["position"]["netPositionEUR"])

    def test_future_quote_is_not_fresh_in_monitor(self):
        result = self.sample(NOW-1)
        self.assertFalse(result["fresh"])
        self.assertIsNone(result["floatingEUR"])

    def test_safe_stop_takes_precedence_over_waiting(self):
        self.source["state"].update(monitoringBlocked=True, quoteWaiting=True, error="permanent")
        self.source["valuationFresh"] = False
        result = self.sample()
        self.assertEqual(result["status"], "SAFE_STOP")
        self.assertTrue(result["position"]["needsReview"])

    def test_telegram_test_does_not_change_trade_and_is_rate_limited(self):
        self.monitor.store.configure({**DEFAULT_SETTINGS, "enabled": True})
        original = deepcopy(self.source)
        with patch("paper_monitor.credentials", return_value=("private", "123")):
            self.monitor.test_notification()
            with self.assertRaises(ValueError):
                self.monitor.test_notification()
        self.assertEqual(self.source, original)

    def test_network_sender_masks_private_url_on_failure(self):
        with patch.dict(os.environ, {"TRADEBOT_TELEGRAM_TOKEN": "123:"+"x"*30, "TRADEBOT_TELEGRAM_CHAT_ID": "123"}), patch("monitor_telegram.urlopen", side_effect=OSError("private token in URL")):
            status, message, _ = send("Test")
        self.assertEqual(status, "UNCERTAIN")
        self.assertNotIn("private", message)
        self.assertNotIn("xxx", message)


class BoundaryContractTests(unittest.TestCase):
    def guard(self, host="127.0.0.1", client="127.0.0.1", origin="http://localhost:5173"):
        from urllib.parse import urlsplit
        from fastapi.responses import JSONResponse
        tree = ast.parse((ROOT/"bridge.py").read_text(encoding="utf-8"))
        function = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "local_only")
        function.decorator_list = []
        pattern = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
                       and any(isinstance(t, ast.Name) and t.id == "ORIGIN_PATTERN" for t in n.targets))
        namespace = {"Request": object, "JSONResponse": JSONResponse, "urlsplit": urlsplit,
                     "re": re, "ORIGIN_PATTERN": pattern}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "bridge-local-guard", "exec"), namespace)
        request = SimpleNamespace(url="http://"+host+":8765/paper-monitor/state", client=SimpleNamespace(host=client),
                                  headers={"origin": origin}, method="GET")

        async def next_response(_request):
            return SimpleNamespace(status_code=200, headers={})

        return asyncio.run(namespace["local_only"](request, next_response))

    def test_actual_guard_rejects_remote_client(self):
        self.assertEqual(self.guard(client="192.168.1.20").status_code, 403)

    def test_actual_guard_rejects_remote_origin_and_host(self):
        self.assertEqual(self.guard(origin="https://example.com").status_code, 403)
        self.assertEqual(self.guard(host="attacker.example").status_code, 403)

    def test_actual_guard_accepts_loopback_and_disables_cache(self):
        response = self.guard()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_observer_modules_have_no_mt5_import_or_execution_calls(self):
        for name in ("paper_monitor.py", "monitor_store.py", "monitor_metrics.py", "monitor_telegram.py", "monitor_routes.py"):
            tree = ast.parse((ROOT/name).read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, (ast.Import, ast.ImportFrom)):
                    text = ast.get_source_segment((ROOT/name).read_text(encoding="utf-8"), node)
                    self.assertNotIn("MetaTrader5", text)
                    self.assertNotIn("ftmo_service", text)
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                    self.assertNotIn(node.func.attr, {"order_send", "order_check", "observe", "market", "pause"})

    def test_local_network_guard_and_port_are_retained(self):
        bridge = (ROOT/"bridge.py").read_text(encoding="utf-8")
        self.assertIn('host not in {"127.0.0.1", "localhost"}', bridge)
        self.assertIn('request.client.host not in {"127.0.0.1", "::1"}', bridge)
        self.assertIn('re.fullmatch(ORIGIN_PATTERN, origin)', bridge)
        self.assertIn('host="127.0.0.1"', bridge)
        self.assertIn('port=8765', bridge)

    def test_mobile_routes_and_safety_labels_are_present(self):
        src = ROOT.parent
        routes = (src/"App.tsx").read_text(encoding="utf-8")
        for route in ("/positions", "/journal-paper", "/statistiques", "/etat", "/v85"):
            self.assertIn('path="'+route+'"', routes)
        layout = (src/"components/monitor/MonitorLayout.tsx").read_text(encoding="utf-8")
        self.assertIn('aria-label="Navigation mobile monitoring"', layout)
        self.assertIn("env(safe-area-inset-bottom)", layout)
        self.assertIn("AUCUN ORDRE MT5", layout)
        self.assertIn("now-t <= 15", layout)
        self.assertNotIn("trialRequest", layout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
