"""Read-only clock evidence. Never infer or apply a trading timestamp offset."""
import io
import json
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

from quote_time import tick_timestamp
from time_basis import validate_time_basis
from preparation_evidence_v76 import fee_evidence, utc_context


def run_clock_tests():
    from test_quote_time import QuoteTimeTests
    from test_time_basis import TimeBasisTests
    from test_paper_trial_time import PaperTrialTimeTests
    from test_paper_trial_waiting import PaperTrialWaitingTests
    suite = unittest.TestSuite([
        unittest.defaultTestLoader.loadTestsFromTestCase(QuoteTimeTests),
        unittest.defaultTestLoader.loadTestsFromTestCase(TimeBasisTests),
        unittest.defaultTestLoader.loadTestsFromTestCase(PaperTrialTimeTests),
        unittest.defaultTestLoader.loadTestsFromTestCase(PaperTrialWaitingTests),
    ])
    output = io.StringIO()
    result = unittest.TextTestRunner(stream=output, verbosity=2).run(suite)
    return {"passed": result.wasSuccessful(), "tests": result.testsRun,
            "failures": len(result.failures), "errors": len(result.errors), "output": output.getvalue()}


def utc(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


def clock_evidence(mt5, terminal, account):
    tests = run_clock_tests()
    samples = []
    candidates = [s.name for s in (mt5.symbols_get() or [])
                  if s.currency_base == "EUR" and s.currency_profit == "USD" and not s.expiration_time]
    fx = "EURUSD" if "EURUSD" in candidates else "EURUSD-ECN" if "EURUSD-ECN" in candidates else candidates[0] if len(candidates) == 1 else None
    symbols = ["XAUUSD"] + ([fx] if fx else [])
    for index in range(2):
        start = time.time()
        ticks = []
        for symbol in symbols:
            if not mt5.symbol_select(symbol, True):
                ticks.append({"symbol": symbol, "error": str(mt5.last_error())})
                continue
            tick = mt5.symbol_info_tick(symbol)
            read_at = time.time()
            if tick is None:
                ticks.append({"symbol": symbol, "error": str(mt5.last_error())})
                continue
            raw = {"symbol": symbol, "time": int(tick.time), "time_msc": int(tick.time_msc),
                   "pythonUTCSeconds": read_at, "pythonUTC": utc(read_at)}
            try:
                timestamp = tick_timestamp(tick)
                raw.update({"interpretedAsUTC": utc(timestamp), "ageSecondsWithoutCorrection": read_at-timestamp,
                            "secondsMillisecondsConsistent": True})
            except ValueError as error:
                raw.update({"secondsMillisecondsConsistent": False, "error": str(error)})
            ticks.append(raw)
        bars = mt5.copy_rates_from_pos("XAUUSD", mt5.TIMEFRAME_M15, 0, 2)
        samples.append({"pythonStartUTC": utc(start), "pythonEndUTC": utc(time.time()), "ticks": ticks,
                        "m15RawOpenTimes": [] if bars is None else [int(row["time"]) for row in bars],
                        "m15Error": str(mt5.last_error()) if bars is None else None})
        if index == 0:
            time.sleep(1)

    probe_path = Path(terminal.data_path) / "MQL5" / "Files" / "tradebot-clock-proof.json"
    native = None
    probe_error = None
    normalization = None
    basis = None
    proof_status = "UNVERIFIABLE"
    quotes_status = "UNVERIFIABLE"
    candidate = None
    validation_stage = "READ_NATIVE_FILE"
    # Read once: the displayed proof must be the exact capture validated below.
    try:
        if probe_path.stat().st_size > 65536:
            raise ValueError("Releve natif trop volumineux.")
        candidate = json.loads(probe_path.read_text(encoding="utf-8-sig"))
        validation_stage = "NATIVE_SCHEMA"
        if not isinstance(candidate, dict) or candidate.get("schemaVersion") != 2:
            raise ValueError("Format du releve natif incompatible : v2 requise.")
        validation_stage = "ACCOUNT_IDENTITY"
        if candidate.get("server") != account.server or str(candidate.get("login")) != str(account.login):
            raise ValueError("Releve natif d'un autre compte/serveur.")
        validation_stage = "NATIVE_TESTER_FLAG"
        if candidate.get("tester") is not False:
            raise ValueError("Releve du Strategy Tester refuse.")
        native = candidate
        validation_stage = "UTC_SELF_TESTS"
        if not tests["passed"]:
            raise ValueError("Autotests en echec : normalisation bloquee.")
        validation_stage = "PYTHON_TIME_BASIS_VALIDATION"
        basis = validate_time_basis(native, mt5, account, time.time())
        normalization = {"encoding": basis.encoding, "ianaZone": basis.zone_name,
                         "serverClock": {"name": basis.server_clock.name, "source": basis.server_clock.source, "confirmedWindow": basis.server_clock.window},
                         "validUntilUTC": utc(basis.valid_until)}
        proof_status = "VERIFIED"
        validation_stage = "VALIDATED"
        conclusion = "Base temporelle verifiee. Ticks et bougies utilisent la meme normalisation UTC ; anciennete maximale 15 s, aucune cotation future acceptee."
    except (ValueError, TypeError, OSError, KeyError, AttributeError) as error:
        probe_error = str(error)
        conclusion = probe_error
        if "ancien ou futur apres normalisation" in probe_error or "Horloges serveur natives non synchronisees" in probe_error:
            # Closed market OR an incoherent feed: never certify the session schedule.
            quotes_status = "UNAVAILABLE"
    if any("error" in tick for sample in samples for tick in sample["ticks"]):
        quotes_status = "UNAVAILABLE"
    elif basis is not None:
        try:
            for sample in samples:
                for tick in sample["ticks"]:
                    from types import SimpleNamespace
                    basis.tick(SimpleNamespace(time=tick["time"], time_msc=tick["time_msc"]),
                               tick["symbol"], tick["pythonUTCSeconds"])
            quotes_status = "AVAILABLE" if fx else "UNAVAILABLE"
        except (ValueError, TypeError) as error:
            quotes_status = "UNAVAILABLE"
            conclusion = str(error)
    observed_at = time.time()
    return {"mode": "PAPER", "liveEnabled": False, "ordersSent": False,
            "diagnosticSchemaVersion": 76, "nativeProbeSource": str(probe_path),
            "nativeProofStatus": proof_status, "quotesStatus": quotes_status,
            "utcValidationDetails": utc_context(candidate, account, observed_at, validation_stage, probe_error),
            "fees": fee_evidence(mt5, account, basis, observed_at, fx),
            "server": str(account.server), "accountLogin": str(account.login),
            "accountType": "DEMO", "packageVersion": str(mt5.__version__),
            "terminalBuild": int(terminal.build), "samples": samples, "nativeProbe": native,
            "nativeProbeError": probe_error, "fxSelectionError": None if fx else "EUR/USD introuvable ou ambigu.",
            "tests": tests, "conversionApplied": normalization is not None and normalization["encoding"] == "SERVER_WALL",
            "normalization": normalization, "conclusion": conclusion}
