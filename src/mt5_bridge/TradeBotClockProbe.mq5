#property strict
#property script_show_inputs
#property description "Releve d'horloges TradeBot en lecture seule. Aucun ordre, aucune conversion."

input string Encoding = "AUTO"; // Compare native ticks with GMT and server clocks
input string ConfirmedIANATimezone = ""; // Full FTMO DST rule, never inferred from GMT+3
input string PolicySource = ""; // FTMO confirmation of that full rule
input bool FullDSTRuleConfirmed = false;

string Quote(string value)
{
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", "\\r");
   StringReplace(value, "\n", "\\n");
   StringReplace(value, "\t", "\\t");
   return "\"" + value + "\"";
}

string TickJSON(string symbol)
{
   MqlTick tick;
   if(!SymbolSelect(symbol, true) || !SymbolInfoTick(symbol, tick))
      return "{\"symbol\":" + Quote(symbol) + ",\"error\":\"tick indisponible\"}";
   return StringFormat("{\"symbol\":%s,\"time\":%I64d,\"time_msc\":%I64d,\"m15Open\":%I64d}",
                       Quote(symbol), (long)tick.time, tick.time_msc, (long)iTime(symbol, PERIOD_M15, 0));
}

string SessionJSON(string symbol, int day)
{
   string intervals = "";
   bool complete = false;
   for(uint index = 0; index < 32; index++)
   {
      datetime from, until;
      ResetLastError();
      if(!SymbolInfoSessionTrade(symbol, (ENUM_DAY_OF_WEEK)day, index, from, until))
      {
         complete = (index > 0 && (GetLastError() == 0 || GetLastError() == 4307));
         break;
      }
      long start = (long)from;
      long end = (long)until;
      if(end == 0 && start > 0) end = 86400;
      if(index > 0) intervals += ",";
      intervals += StringFormat("[%I64d,%I64d]", start, end);
   }
   return StringFormat("{\"day\":%d,\"complete\":%s,\"intervals\":[%s]}", day, complete ? "true" : "false", intervals);
}

void CaptureProof()
{
   string server = AccountInfoString(ACCOUNT_SERVER);
   if(StringFind(server, "FTMO-Demo") != 0 || AccountInfoInteger(ACCOUNT_TRADE_MODE) != ACCOUNT_TRADE_MODE_DEMO)
   {
      Print("Releve refuse : compte FTMO-Demo DEMO requis.");
      return;
   }
   if(MQLInfoInteger(MQL_TESTER))
   {
      Print("Releve refuse dans le Strategy Tester.");
      return;
   }
   // Capture separate native clock APIs, not an offset inferred from tick age.
   datetime current = TimeCurrent();
   datetime tradeServer = TimeTradeServer();
   datetime gmt = TimeGMT();
   datetime local = TimeLocal();
   string data = StringFormat("{\"schemaVersion\":2,\"server\":%s,\"login\":%I64d,\"tester\":false,\"timeCurrent\":%I64d,\"timeTradeServer\":%I64d,\"timeGMT\":%I64d,\"timeLocal\":%I64d,\"timeGMTOffset\":%d,\"timeDaylightSavings\":%d,\"encoding\":%s,\"confirmedPolicy\":{\"confirmed\":%s,\"ianaZone\":%s,\"source\":%s},\"ticks\":[%s,%s]}",
                             Quote(server), AccountInfoInteger(ACCOUNT_LOGIN), (long)current, (long)tradeServer,
                             (long)gmt, (long)local, TimeGMTOffset(), TimeDaylightSavings(), Quote(Encoding),
                             FullDSTRuleConfirmed ? "true" : "false", Quote(ConfirmedIANATimezone), Quote(PolicySource),
                             TickJSON("XAUUSD"), TickJSON("EURUSD"));
   MqlDateTime serverDate;
   TimeToStruct(tradeServer, serverDate);
   data = StringSubstr(data, 0, StringLen(data)-1) + ",\"tradeSessions\":{\"XAUUSD\":"
          + SessionJSON("XAUUSD", serverDate.day_of_week) + ",\"EURUSD\":"
          + SessionJSON("EURUSD", serverDate.day_of_week) + "}}";
   int handle = FileOpen("tradebot-clock-proof.tmp", FILE_WRITE | FILE_TXT | FILE_ANSI, 0, CP_UTF8);
   if(handle == INVALID_HANDLE)
   {
      Print("Impossible d'ecrire le releve : ", GetLastError());
      return;
   }
   uint written = FileWriteString(handle, data);
   FileFlush(handle);
   FileClose(handle);
   if(written == 0 || !FileMove("tradebot-clock-proof.tmp", 0, "tradebot-clock-proof.json", FILE_REWRITE))
      Print("Publication de preuve refusee : ", GetLastError());
}

void OnStart()
{
   // Native clock observer only. Does not start the PAPER worker or send orders.
   // Each renewal is independently checked by Python; an old file never gets extended.
   while(!IsStopped())
   {
      CaptureProof();
      Sleep(30000);
   }
}
