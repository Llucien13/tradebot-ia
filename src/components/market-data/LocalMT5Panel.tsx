import { useEffect, useState } from "react";
import { Cable, CheckCircle2, Loader2, ShieldCheck, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { bridgeCandlesSchema, bridgeStatusSchema, MT5_BRIDGE_TIMEFRAMES, MT5_BRIDGE_URL, readLocalMT5, type MT5BridgeCandles, type MT5BridgeStatus, type MT5BridgeTimeframe } from "@/lib/mt5-local-bridge";
import { MT5ClockDetails } from "./MT5ClockDetails";

const utc = (time: number | string) => new Date(time).toLocaleString("fr-FR", { timeZone: "UTC" });

export function LocalMT5Panel({ goldFocus = false }: { goldFocus?: boolean } = {}) {
  const [enabled, setEnabled] = useState(false), [attempt, setAttempt] = useState(0);
  const [timeframe, setTimeframe] = useState<MT5BridgeTimeframe>(goldFocus ? "M15" : "M5");
  const [status, setStatus] = useState<MT5BridgeStatus | null>(null);
  const [history, setHistory] = useState<MT5BridgeCandles | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [historyError, setHistoryError] = useState("");
  const symbol = goldFocus ? "XAUUSD" : "XAUUSD-ECN";
  const expectedAccount = goldFocus ? "FTMO-Demo" : "VT Markets DEMO";
  useEffect(() => {
    if (!enabled) return;
    let active = true, reported = false;
    let current: AbortController | null = null;
    setHistory(null); setHistoryError("");
    const refresh = async () => {
      if (current) return;
      const controller = new AbortController(); current = controller;
      const timeout = window.setTimeout(() => controller.abort(), 20000);
      setBusy(true);
      try {
        const snapshot = await readLocalMT5(`/status?symbol=${symbol}`, bridgeStatusSchema, controller.signal);
        if (!active) return;
        if (snapshot.symbol !== symbol) throw new Error(`La passerelle retourne ${snapshot.symbol}, mais ${symbol} est demandé. Relancez la passerelle mise à jour ; aucune substitution de symbole.`);
        setStatus(snapshot); setError("error" in snapshot ? snapshot.error : "");
        if (!snapshot.connected) { setHistory(null); setHistoryError(""); return; }
        try {
          const data = await readLocalMT5(`/candles?symbol=${symbol}&timeframe=${timeframe}&count=300`, bridgeCandlesSchema, controller.signal);
          if (data.symbol !== symbol || data.timeframe !== timeframe) throw new Error("Symbole ou unité de temps MT5 incohérent : données refusées. Relancez la passerelle mise à jour.");
          if (active) {
            setHistory(data); setHistoryError("");
            if (!reported) {
              console.info("[MT5 lecture] Cotations et bougies reçues", { symbol: data.symbol, timeframe: data.timeframe, server: snapshot.account.server, accountType: snapshot.account.type, currency: snapshot.account.currency, readOnly: snapshot.readOnly, mode: snapshot.mode, liveEnabled: snapshot.liveEnabled, quotesAvailable: !!snapshot.quote, bid: snapshot.quote?.bid, ask: snapshot.quote?.ask, tickTime: snapshot.quote?.time, candles: data.candles.length, closedBarsOnly: data.closedBarsOnly, lastClosedBar: data.candles[data.candles.length-1] });
              reported = true;
            }
          }
        } catch (e) {
          if (active) { setHistory(null); setHistoryError(controller.signal.aborted ? "Délai de lecture des bougies MT5 dépassé." : e instanceof Error ? e.message : "Lecture des bougies impossible."); }
        }
      } catch (e) {
        if (active) { setStatus(null); setHistory(null); setHistoryError(""); setError(controller.signal.aborted ? "Délai MT5 dépassé. Vérifiez le terminal et la passerelle locale." : e instanceof Error ? e.message : "Connexion MT5 impossible."); }
      } finally {
        window.clearTimeout(timeout); current = null;
        if (active) setBusy(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => { active = false; window.clearInterval(timer); current?.abort(); };
  }, [enabled, attempt, timeframe, symbol]);
  const connected = status?.connected === true;
  const account = status?.connected ? status.account : null;
  const quote = status?.connected ? status.quote : null;
  const brokerMatches = account ? goldFocus ? /^FTMO-Demo/i.test(account.server) : /vt\s*markets|vtmarkets/i.test(`${account.company} ${account.server}`) : false;
  const price = (value: number) => value.toFixed(quote?.digits ?? 2);
  return <section className="space-y-5 rounded-3xl border border-primary/25 bg-card p-5 sm:p-6" aria-labelledby="local-mt5-title">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3"><span className="rounded-2xl bg-primary/10 p-3 text-primary"><Cable className="h-6 w-6" /></span><div><h2 id="local-mt5-title" className="text-xl font-bold">MetaTrader 5 · connexion locale</h2><p className="mt-1 text-sm text-muted-foreground">{expectedAccount} attendu · {symbol} · lecture seule</p></div></div>
      <span role="status" className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${connected ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-secondary text-foreground"}`}>{connected ? <CheckCircle2 className="h-4 w-4" /> : <Unplug className="h-4 w-4" />}{connected ? "Connecté" : "Déconnecté"}{busy && <Loader2 className="h-4 w-4 animate-spin" />}</span>
    </div>
    <div className="flex flex-wrap items-center gap-3"><Button disabled={busy} onClick={() => { setEnabled(true); setAttempt(v => v + 1); }} className="min-h-12 rounded-xl px-5 font-semibold"><Cable className="mr-2 h-4 w-4" />Tester la connexion MT5</Button><p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 text-primary" />PAPER uniquement · LIVE désactivé · aucun ordre MT5</p></div>
    {!enabled && <p className="text-sm text-muted-foreground">Lancez start_mt5_bridge.bat sur votre PC Windows, puis testez la connexion. Aucun mot de passe demandé. Le test ne démarre pas le bot.</p>}
    {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">{error}</p>}
    {status?.connected && quote && <MT5ClockDetails tickTime={quote.time} fetchedAt={status.fetchedAt} />}
    {account && <>
      {(account.type !== "DEMO" || !brokerMatches) && <p role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-foreground">Le terminal retourne {account.type} · {account.company} · {account.server}, et non le compte {expectedAccount} attendu. Vérifiez le compte dans MT5. La passerelle reste strictement en lecture seule ; le flux du simulateur FTMO refuse tout compte autre que FTMO-Demo.</p>}
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        ["Compte réellement retourné", `${account.type} · ${account.login}`], ["Broker / serveur", `${account.company} · ${account.server}`],
        ["Solde MT5", `${account.balance.toLocaleString("fr-FR")} ${account.currency}`], ["Equity MT5", `${account.equity.toLocaleString("fr-FR")} ${account.currency}`],
      ].map(([label, value]) => <div key={label} className="min-w-0 rounded-2xl border border-border bg-secondary/40 p-4"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-2 break-words text-sm font-semibold">{value}</dd></div>)}</dl>
      {quote ? <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-primary/20 bg-primary/5 p-4"><div><p className="text-xs text-muted-foreground">BID · {symbol}</p><p className="mt-1 font-mono text-2xl font-bold text-primary">{price(quote.bid)}</p></div><div><p className="text-xs text-muted-foreground">ASK</p><p className="mt-1 font-mono text-2xl font-bold">{price(quote.ask)}</p></div><p className="text-xs text-muted-foreground">Dernier tick : {utc(quote.time)} UTC<br />Volume maximal lu dans MT5 : {quote.maxLot} lots<br />{Date.now() - quote.time > 120000 ? "Tick ancien : marché fermé ou cotation non actualisée." : "Horodatage fourni par MT5."}</p></div> : <p role="alert" className="text-sm">{status?.connected ? status.quoteError : "Cotations indisponibles."}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Bougies réelles clôturées</h3><p className="mt-1 text-xs text-muted-foreground">300 dernières disponibles · UTC · aucun comblement de trous</p></div>{goldFocus ? <span className="rounded-xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm font-semibold text-primary">GOLD M15</span> : <Select value={timeframe} onValueChange={value => setTimeframe(value as MT5BridgeTimeframe)}><SelectTrigger aria-label="Unité de temps MT5" className="h-11 w-28 rounded-xl bg-secondary"><SelectValue /></SelectTrigger><SelectContent className="rounded-xl">{MT5_BRIDGE_TIMEFRAMES.map(tf => <SelectItem key={tf} value={tf}>{tf}</SelectItem>)}</SelectContent></Select>}</div>
      {historyError && <p role="alert" className="text-sm text-destructive">{historyError}</p>}
      {history && <div className="space-y-2"><p className="text-xs text-muted-foreground">{history.candles.length} bougies {history.timeframe} {history.symbol} retournées par MT5. Les 8 dernières sont affichées ci-dessous.</p><div className="overflow-x-auto rounded-xl border border-border"><table className="w-full whitespace-nowrap text-left text-xs"><caption className="sr-only">Dernières bougies MT5 {history.timeframe} de {history.symbol}</caption><thead className="bg-secondary"><tr>{["Ouverture UTC", "Open", "High", "Low", "Close", "Volume ticks"].map(label => <th key={label} className="px-3 py-3 font-semibold">{label}</th>)}</tr></thead><tbody>{history.candles.slice(-8).reverse().map(row => <tr key={row.time} className="border-t border-border"><td className="px-3 py-3">{utc(row.time)}</td>{[row.open, row.high, row.low, row.close].map((value, index) => <td key={index} className="px-3 py-3 font-mono">{price(value)}</td>)}<td className="px-3 py-3">{row.tickVolume}</td></tr>)}</tbody></table></div></div>}
      {status?.connected && <p className="break-words text-xs text-muted-foreground">Source : package officiel MetaTrader5 {status.packageVersion} · {status.terminal.name} · {status.terminal.path}<br />Lecture : {utc(status.fetchedAt)} UTC · actualisation toutes les 10 s après le test.</p>}
    </>}
    <p className="break-words border-t border-border pt-4 text-xs text-muted-foreground">Passerelle : {MT5_BRIDGE_URL} · Documentation Windows : src/mt5_bridge/INSTALLATION.md. Ce panneau ne remplace pas les flux de vos stratégies et ne modifie aucun profil ou backtest.</p>
  </section>;
}
