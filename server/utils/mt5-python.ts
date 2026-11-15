import { MT5_TERMINAL_DIAGNOSTIC } from "./mt5-terminal-diagnostic";

// Official MetaTrader5 Python API, strictly historical data and terminal metadata.
// Passed as fixed code to Python; user values arrive as JSON on stdin, never as code.
export const MT5_READER = String.raw`
import sys, json, math, re, os
from datetime import datetime, timezone, timedelta
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
${MT5_TERMINAL_DIAGNOSTIC}

def fail(message):
    raise RuntimeError(message)

def utc_iso(milliseconds):
    return datetime.fromtimestamp(milliseconds / 1000, tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

def candidates(mt5):
    symbols = mt5.symbols_get()
    if symbols is None:
        fail("Lecture des symboles impossible : " + str(mt5.last_error()))
    result = []
    for symbol in symbols:
        base = str(getattr(symbol, "currency_base", "")).upper()
        profit = str(getattr(symbol, "currency_profit", "")).upper()
        name = symbol.name.upper()
        normalized = re.sub(r"[^A-Z0-9]", "", name)
        # Exclude expiring futures and symbols explicitly priced in another currency.
        if getattr(symbol, "expiration_time", 0) or profit != "USD":
            continue
        explicit = base == "XAU"
        named = normalized.startswith("XAUUSD")
        gold = bool(re.match(r"^GOLD(?:USD)?(?:[._-].*|[A-Z0-9]*)$", name)) and "GOLD" in symbol.description.upper()
        if not (explicit or named or gold):
            continue
        result.append({"name": symbol.name, "description": str(symbol.description), "currencyBase": base,
            "currencyProfit": profit, "digits": int(symbol.digits), "visible": bool(symbol.visible),
            "reason": "XAU et devise de profit USD" if explicit else "Nom XAUUSD et devise USD" if named else "Gold identifié par nom, description et devise USD"})
    return sorted(result, key=lambda item: item["name"])

def preferred(symbols):
    exact = [symbol for symbol in symbols if symbol["name"].upper() == "XAUUSD"]
    if len(exact) == 1:
        return exact[0]["name"]
    return symbols[0]["name"] if len(symbols) == 1 else None

mt5 = None
initialized = False
try:
    request = json.load(sys.stdin)
    try:
        import MetaTrader5 as mt5
    except ImportError:
        fail("Le package officiel MetaTrader5 est absent ou incompatible avec ce Python. Utilisez le bouton d'installation du connecteur officiel (Python Windows 64 bits requis).")
    path = request.get("terminalPath", "").strip()
    try:
        terminals, complete = running_terminals()
    except Exception:
        terminals, complete = [], False
    paths = {normalized_path(item["path"]) for item in terminals}
    if path and terminals and complete and normalized_path(path) not in paths:
        fail("Le chemin demandé ne correspond à aucun terminal MT5 ouvert. Initialisation annulée pour ne pas lancer une autre installation avec un autre compte mémorisé. " + initialization_context(path, terminals, complete) + "Copiez le chemin du terminal réellement connecté à votre compte démo dans le champ existant.")
    if not path and complete and len(terminals) == 1:
        path = terminals[0]["path"]
    elif not path and terminals and (len(terminals) > 1 or not complete):
        fail("La détection du terminal ouvert est ambiguë. Renseignez le chemin du terminal souhaité dans le champ existant. " + initialization_context(path, terminals, complete))
    # The executable is the documented positional argument; no login, password,
    # server or portable override is supplied. No alternate-account retry is made.
    initialized = bool(mt5.initialize(path, timeout=15000) if path else mt5.initialize(timeout=15000))
    if not initialized:
        error = mt5.last_error()
        context = initialization_context(path, terminals, complete)
        if error[0] == -6:
            fail("MT5 initialize : " + str(error) + " (RES_E_AUTH_FAILED). " + context +
                "Le terminal ciblé refuse l'autorisation du compte utilisé par initialize, qui peut reprendre le dernier compte et ses paramètres mémorisés même sans identifiants fournis. Ce code ne précise pas la cause et ne concerne pas l'autorisation de trading Python. " +
                "Vérifiez le chemin de l'instance démo et son Journal à l'heure du clic ; reconnectez ce compte dans MT5 seulement si le Journal le demande. Aucun login, mot de passe ou serveur n'a été envoyé par TradeBot IA.")
        fail("Initialisation MT5 impossible : " + str(error) + ". " + context + "Version du package officiel : " + str(mt5.__version__) + ". Aucun identifiant n'a été envoyé.")
    terminal = mt5.terminal_info()
    if terminal is None or not terminal.connected:
        fail("Terminal MT5 non connecté au serveur du broker. Connectez-vous dans le terminal ; aucun identifiant n'a été demandé à TradeBot IA.")
    if path and normalized_path(os.path.join(terminal.path, "terminal64.exe")) != normalized_path(path):
        fail("L'API MT5 a retourné une autre installation que le chemin demandé. Lecture annulée. Chemin demandé : " + path + ". Installation retournée : " + str(terminal.path))
    symbols = candidates(mt5)
    selected = preferred(symbols)
    if request["action"] == "status":
        result = {"source": "MT5", "connected": True, "readOnly": True, "packageVersion": str(mt5.__version__),
            "terminalName": str(terminal.name), "maxBars": int(terminal.maxbars), "symbols": symbols,
            "selectedSymbol": selected, "warnings": ["Aucun ordre ni mode live dans cet adaptateur. Seule la lecture officielle de données est implémentée.",
                "Installation retournée par l'API : " + str(terminal.path) + ". Dossier de données : " + str(terminal.data_path) + ". Aucun identifiant transmis à initialize."]}
        if not symbols:
            result["warnings"].append("Aucun symbole Gold/USD spot ou CFD non expirant identifié. Vérifiez les instruments proposés par votre broker ; aucune variante n'est inventée.")
        elif selected is None:
            result["warnings"].append("Plusieurs variantes Gold/USD existent : choisissez explicitement le symbole broker détecté.")
    elif request["action"] == "history":
        name = request.get("symbol") or selected
        if not name or name not in [symbol["name"] for symbol in symbols]:
            fail("Sélectionnez l'un des symboles Gold/USD réellement détectés. Aucun symbole arbitraire ou ambigu ne sera utilisé.")
        if not mt5.symbol_select(name, True):
            fail("Impossible d'ajouter ce symbole à l'Observation du marché : " + str(mt5.last_error()))
        info = mt5.symbol_info(name)
        if info is None:
            fail("Métadonnées du symbole MT5 indisponibles.")
        start = int(request["startMs"])
        end = int(request["endMs"])
        warmup = int(request["warmup"])
        timeframe = request["timeframe"]
        minutes_per_bar = {"M1": 1, "M5": 5, "M15": 15}[timeframe]
        bar_ms = minutes_per_bar * 60000
        expected_bars = (end - start) // bar_ms
        if expected_bars < 2:
            fail("La plage demandée ne contient que " + str(expected_bars) + " barres " + timeframe + ". Étendez la plage au minimum à deux barres " + timeframe + " clôturées.")
        # Each request covers at most 5,000 bar slots; the total range has no such cap.
        cursor = start - 7 * 86400000 if warmup else start
        earliest_ms = cursor
        tf_const = getattr(mt5, "TIMEFRAME_" + timeframe)
        rates = []
        while cursor < end:
            batch_end = min(end, cursor + 5000 * bar_ms)
            batch = mt5.copy_rates_range(name, tf_const,
                datetime.fromtimestamp(cursor / 1000, tz=timezone.utc),
                datetime.fromtimestamp((batch_end - 1000) / 1000, tz=timezone.utc))
            if batch is None:
                fail("copy_rates_range " + timeframe + " a échoué : " + str(mt5.last_error()))
            rates.extend(batch)
            cursor = batch_end
            pct = round((cursor - earliest_ms) / (end - earliest_ms) * 95)
            print("PROGRESS " + str(pct), file=sys.stderr, flush=True)
        before = []
        tested = []
        previous = -1
        for rate in rates:
            milliseconds = int(rate["time"]) * 1000
            if milliseconds <= previous or milliseconds % bar_ms:
                fail("Historique MT5 désordonné, dupliqué ou non aligné sur la barre " + timeframe + ".")
            previous = milliseconds
            o, h, l, c = [float(rate[field]) for field in ["open", "high", "low", "close"]]
            if not all(math.isfinite(value) and value > 0 for value in [o, h, l, c]) or h < max(o, c) or l > min(o, c) or h < l:
                fail("OHLC MT5 incohérent : aucun prix ne sera corrigé ou inventé.")
            candle = {"time": milliseconds, "open": o, "high": h, "low": l, "close": c, "volume": int(rate["tick_volume"])}
            if milliseconds < start:
                before.append(candle)
            elif milliseconds + bar_ms <= end:
                tested.append(candle)
        if len(before) < warmup:
            fail("Préchauffage insuffisant dans l'historique réellement disponible sur les 7 jours précédents. Chargez davantage d'historique " + timeframe + " dans MT5 et vérifiez 'Barres max dans le graphique'.")
        if len(tested) < 2:
            fail("Moins de deux bougies " + timeframe + " clôturées dans la plage demandée. Vérifiez la disponibilité chez le broker, la date et l'historique chargé dans MT5.")
        candles = (before[-warmup:] if warmup else []) + tested
        expected = int((end - start) // bar_ms)
        missing = max(0, expected - len(tested))
        gaps = []
        gap_count = 0
        next_time = start
        for candle in tested:
            if candle["time"] > next_time:
                gap_count += 1
                if len(gaps) < 30:
                    gaps.append({"from": utc_iso(next_time), "to": utc_iso(candle["time"]), "minutes": (candle["time"] - next_time) // 60000})
            next_time = candle["time"] + bar_ms
        if next_time < end:
            gap_count += 1
            if len(gaps) < 30:
                gaps.append({"from": utc_iso(next_time), "to": utc_iso(end), "minutes": (end - next_time) // 60000})
        warnings = ["Source MT5 indépendante : aucune requête Twelve Data et aucun ordre réel.",
            "Volumes de ticks, pas volumes physiques négociés. Les spreads MT5 ne remplacent pas les coûts configurables du backtest.",
            "Les dates et secondes MT5 sont converties en UTC et timestamps JavaScript en millisecondes.",
            "Historique limité par le broker et les barres accessibles au terminal. Aucune interpolation ni remplissage des absences.",
            "Ces bougies ne sont pas injectées automatiquement dans les backtests existants."]
        if missing:
            warnings.append("Couverture partielle : des minutes manquent (fermetures, absence de cotations ou historique tronqué). Aucun calendrier broker n'est supposé ; un backtest intégral n'est pas validé automatiquement.")
        basis = "LAST" if int(getattr(info, "chart_mode", 0)) == 1 else "BID"
        warnings.append("Prix " + basis + " du graphique broker : ce ne sont pas nécessairement des prix médians. Leur base devra être respectée lors d'un futur raccordement au modèle de spread.")
        result = {"source": "MT5", "symbol": name, "interval": {"M1": "1m", "M5": "5m", "M15": "15m"}[timeframe], "apiTimeframe": "TIMEFRAME_" + timeframe, "priceBasis": basis,
            "volumeKind": "TICK_VOLUME", "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "cached": False, "candles": candles, "warnings": warnings,
            "coverage": {"requestedStart": request["start"], "requestedEnd": request["end"], "warmupCount": warmup,
                "testedCount": len(tested), "expectedMinutes": expected * minutes_per_bar, "missingMinutes": missing * minutes_per_bar,
                "first": utc_iso(tested[0]["time"]), "last": utc_iso(tested[-1]["time"]), "gaps": gaps, "gapCount": gap_count}}
    else:
        fail("Action de lecture MT5 inconnue.")
    print(json.dumps({"ok": True, "data": result}, ensure_ascii=False, allow_nan=False))
except Exception as error:
    print(json.dumps({"ok": False, "message": str(error)}, ensure_ascii=False))
finally:
    if mt5 is not None:
        mt5.shutdown()
`;