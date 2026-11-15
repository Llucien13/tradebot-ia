"""Read-only fee units and UTC failure context. Never supplies trading defaults."""
import math
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo


def finite(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def fee_evidence(mt5, account, basis, now, fx_symbol):
    result = {"source": "MT5.symbol_info(XAUUSD)", "server": str(account.server),
              "login": str(account.login), "observedUTC": now, "status": "BLOCKED",
              "units": "USD par lot et par rollover simple, signe conserve",
              "swapLongUSD": None, "swapShortUSD": None, "swapHourUTC": None,
              "blockers": [], "appliedToLedger": False}
    if account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO or not str(account.server).casefold().startswith("ftmo-demo"):
        result["blockers"].append("Compte DEMO FTMO-Demo requis.")
        return result
    try:
        info = mt5.symbol_info("XAUUSD")
        if info is None:
            raise ValueError("Specifications XAUUSD absentes.")
        fields = ("swap_mode", "swap_long", "swap_short", "swap_rollover3days", "point", "trade_contract_size", "trade_calc_mode", "currency_base", "currency_profit", "currency_margin")
        result["raw"] = {name: getattr(info, name, None) for name in fields}
        result["invalidNumericFields"] = [name for name, value in result["raw"].items() if isinstance(value, float) and not math.isfinite(value)]
        for name in result["invalidNumericFields"]:
            result["raw"][name] = None
        result["accountCurrency"] = getattr(account, "currency", None)
        mode, long, short = info.swap_mode, info.swap_long, info.swap_short
        if not finite(long) or not finite(short) or type(mode) is not int:
            raise ValueError("Mode ou valeurs de swap invalides.")
        # Official ENUM_SYMBOL_SWAP_MODE values, not monetary unit guesses.
        if mode == 0:
            if long != 0 or short != 0:
                raise ValueError("Swaps non nuls avec mode DISABLED : specification incoherente.")
            factor, formula = 0.0, "DISABLED : aucun swap selon specification MT5"
        elif mode == 1:
            # Official ENUM_SYMBOL_CALC_MODE IDs; some Python MT5 builds omit the names.
            linear_modes = [getattr(mt5, name, value) for name, value in (("SYMBOL_CALC_MODE_FOREX", 0), ("SYMBOL_CALC_MODE_FOREX_NO_LEVERAGE", 5), ("SYMBOL_CALC_MODE_CFD", 2), ("SYMBOL_CALC_MODE_CFDLEVERAGE", 4))]
            if getattr(info, "trade_calc_mode", None) is None or info.trade_calc_mode not in linear_modes:
                raise ValueError("Mode de calcul non demontre lineaire : conversion POINTS refusee.")
            if info.currency_profit != "USD" or not finite(info.point) or info.point <= 0 or not finite(info.trade_contract_size) or info.trade_contract_size <= 0:
                raise ValueError("POINTS exige un contrat lineaire de profit USD et point/contract_size positifs.")
            factor, formula = info.point * info.trade_contract_size, "swap_points * point * trade_contract_size (USD/lot)"
        elif mode in (2, 3, 4):
            currency = {2: getattr(info, "currency_base", None), 3: info.currency_margin, 4: getattr(account, "currency", None)}[mode]
            # 2=CURRENCY_SYMBOL (base), 3=CURRENCY_MARGIN, 4=CURRENCY_DEPOSIT.
            result["rawSwapCurrency"] = currency
            if currency == "USD":
                factor, formula = 1.0, "swap deja exprime en USD/lot"
            elif currency == "EUR":
                if basis is None or not fx_symbol:
                    raise ValueError("Conversion EUR vers USD bloquee : preuve UTC/FX valide requise.")
                fx_info = mt5.symbol_info(fx_symbol)
                tick = mt5.symbol_info_tick(fx_symbol)
                if fx_info is None or fx_info.currency_base != "EUR" or fx_info.currency_profit != "USD" or tick is None or not finite(tick.bid) or not finite(tick.ask) or tick.bid <= 0 or tick.ask < tick.bid:
                    raise ValueError("Cotation EUR/USD non verifiable.")
                basis.tick(tick, fx_symbol, now)
                factor, formula = (tick.bid + tick.ask) / 2, "swap_EUR * mid EURUSD (convention FX du moteur PAPER)"
                result["fx"] = {"symbol": fx_symbol, "bid": tick.bid, "ask": tick.ask, "usdPerEUR": factor}
            else:
                raise ValueError("Devise de swap non convertible sans source verifiee : " + str(currency))
        else:
            raise ValueError("Mode de swap interet/reouverture/autre incompatible avec un montant fixe USD/lot; aucune approximation.")
        converted = [long * factor, short * factor]
        if not all(finite(value) for value in converted):
            raise ValueError("Conversion de swap non finie.")
        result.update(swapLongUSD=converted[0], swapShortUSD=converted[1], conversionFormula=formula, conversionFactor=factor)
        result["status"] = "SWAP_AMOUNTS_VERIFIED_ROLLOVER_UNVERIFIABLE"
        clock = getattr(basis, "server_clock", None)
        if clock is None or basis.valid_until is None or now > basis.valid_until:
            raise ValueError("Preuve UTC native et calendrier serveur valides requis pour minuit serveur.")
        cutoff = clock.last_midnight(now)
        hour = datetime.fromtimestamp(cutoff, timezone.utc).hour
        if datetime.fromtimestamp(cutoff, timezone.utc).minute != 0:
            raise ValueError("Rollover non representable par une heure UTC entiere.")
        result.update(swapHourUTC=hour, lastRolloverUTC=cutoff,
                      serverClock={"name": clock.name, "source": clock.source, "confirmedWindow": clock.window},
                      status="VERIFIED")
    except (ValueError, TypeError, AttributeError) as error:
        result["blockers"].append(str(error))
    return result


def utc_context(candidate, account, now, stage, error):
    result = {"stage": stage, "pythonValidationError": error, "pythonUTCSeconds": now,
              "connectedAccount": {"server": str(account.server), "login": str(account.login)},
              "annualPolicyStatus": "UNVERIFIABLE", "annualPolicyExternallyVerified": False}
    if not isinstance(candidate, dict):
        return result
    result["nativeCapture"] = candidate
    result["serverMatches"] = candidate.get("server") == account.server
    result["loginMatches"] = str(candidate.get("login")) == str(account.login)
    gmt, server, current = (candidate.get(key) for key in ("timeGMT", "timeTradeServer", "timeCurrent"))
    if finite(gmt):
        result["nativeAgeSeconds"] = now - gmt
    if finite(server) and finite(gmt):
        result["observedServerMinusGMTSeconds"] = server - gmt
    if finite(server) and finite(current):
        result["currentMinusTradeServerSeconds"] = current - server
    policy = candidate.get("confirmedPolicy")
    if not isinstance(policy, dict) or policy.get("confirmed") is not True or not isinstance(policy.get("source"), str) or not policy["source"].strip() or not finite(gmt):
        result["annualPolicyReason"] = "Confirmation et source de regle annuelle absentes; un offset instantane ne prouve pas la regle FTMO."
        return result
    try:
        zone = ZoneInfo(policy["ianaZone"])
        start = datetime(datetime.fromtimestamp(gmt, timezone.utc).year, 1, 1, tzinfo=timezone.utc)
        end = start.replace(year=start.year + 1)
        offset = lambda stamp: int(stamp.astimezone(zone).utcoffset().total_seconds())
        result["declaredIANAZone"] = zone.key
        result["policySource"] = policy["source"]
        expected = offset(datetime.fromtimestamp(gmt, timezone.utc))
        result["declaredOffsetAtCaptureSeconds"] = expected
        result["offsetMatchesNative"] = finite(server) and abs(server - gmt - expected) <= 2
        transitions, previous = [], start
        while previous < end:
            following = min(previous + timedelta(days=1), end)
            if offset(previous) != offset(following):
                low, high = int(previous.timestamp()), int(following.timestamp())
                old_offset = offset(previous)
                while high - low > 1:
                    middle = (low + high) // 2
                    if offset(datetime.fromtimestamp(middle, timezone.utc)) == old_offset:
                        low = middle
                    else:
                        high = middle
                transitions.append({"utc": datetime.fromtimestamp(high, timezone.utc).isoformat(), "beforeSeconds": old_offset, "afterSeconds": offset(following)})
            previous = following
        result["annualTransitionsFromDeclaredZone"] = transitions
        result["annualPolicyStatus"] = "DECLARED_RULE_CONSISTENT_NOW" if result["offsetMatchesNative"] else "DECLARED_RULE_CONTRADICTS_CAPTURE"
        result["annualPolicyReason"] = "Calendrier calcule depuis le fuseau deja declare, sans selection automatique. La source FTMO doit confirmer cette regle annuelle; sa seule presence textuelle n'est pas une attestation externe."
    except (KeyError, ValueError, TypeError, OverflowError) as failure:
        result["annualPolicyReason"] = str(failure)
    return result
