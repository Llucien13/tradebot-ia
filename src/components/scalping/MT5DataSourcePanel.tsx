import { useEffect, useRef, useState } from "react";
import { Database, Download, Loader2, Plug, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Field, NumberField, Section, actionClass, selectClass } from "@/components/strategy/StrategyFields";
import { MT5DataAdapter } from "@/lib/MT5DataAdapter";
import { frenchDateToISO, mt5FrenchUTC, barsIn7Days, type MT5Timeframe } from "@/lib/mt5-data";
import { useMT5DataSession, updateMT5DataSession } from "@/lib/mt5-data-session";
import { exportCSV } from "@/lib/ui-presentation";

const adapter = new MT5DataAdapter();
const maskDate = (value: string) => value.replace(/\D/g, "").slice(0, 8).replace(/^(\d{2})(\d)/, "$1/$2").replace(/^(\d{2}\/\d{2})(\d)/, "$1/$2");
const price = (value: number) => value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 5 });

export function MT5DataSourcePanel({ fixedTimeframe }: { fixedTimeframe?: "M1" | "M5" }) {
  const scope = fixedTimeframe === "M5" ? "M5" : undefined;
  const { terminalPath, symbol, status, history, startDate, endDate, warmup } = useMT5DataSession(scope);
  const updateSession = (update: Parameters<typeof updateMT5DataSession>[0]) => updateMT5DataSession(update, scope);
  const [busy, setBusy] = useState<"install" | "status" | "history" | null>(null);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [timeframe, setTimeframe] = useState<MT5Timeframe>(fixedTimeframe ?? "M1");
  const [progress, setProgress] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const request = useRef<AbortController | null>(null);
  const tokenRef = useRef<string | null>(null);
  const cancelled = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (tokenRef.current) void adapter.cancel(tokenRef.current).catch(() => {});
      request.current?.abort();
    };
  }, []);
  const action = async (kind: NonNullable<typeof busy>, operation: (signal: AbortSignal) => Promise<void>) => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    cancelled.current = false;
    const timer = window.setTimeout(() => {
      if (tokenRef.current) void adapter.cancel(tokenRef.current).catch(() => {});
      controller.abort();
    }, kind === "history" ? 660000 : kind === "install" ? 240000 : 120000);
    setBusy(kind); setError(""); setMessage(""); setCancelling(false);
    try { await operation(controller.signal); }
    catch (e) {
      if (mounted.current) setError(cancelled.current ? "Chargement annulé. Le dernier lot réussi reste conservé." : controller.signal.aborted ? "Le pont MT5 a dépassé le délai ou a été interrompu. Aucun historique ni ordre n’est inventé." : e instanceof Error ? e.message : "Lecture MT5 impossible.");
    }
    finally {
      window.clearTimeout(timer); request.current = null; tokenRef.current = null;
      if (mounted.current) { setBusy(null); setCancelling(false); }
    }
  };
  const cancelLoad = async () => {
    if (!tokenRef.current || cancelling) return;
    setCancelling(true);
    try {
      const result = await adapter.cancel(tokenRef.current);
      if (result.cancelled) { cancelled.current = true; request.current?.abort(); }
      else if (mounted.current) { setCancelling(false); setMessage("Initialisation en cours : réessayez l’annulation dans un instant."); }
    } catch (e) {
      if (mounted.current) { setCancelling(false); setError(e instanceof Error ? e.message : "Annulation impossible."); }
    }
  };
  const detect = () => void action("status", async signal => {
    updateSession({ status: null });
    const result = await adapter.inspect({ terminalPath }, signal);
    if (signal.aborted) return;
    updateSession({ status: result, symbol: result.symbols.some(s => s.name === "XAUUSD-ECN") ? "XAUUSD-ECN" : result.selectedSymbol ?? "" });
    setMessage(result.symbols.length ? "Terminal connecté : choisissez le symbole détecté si plusieurs variantes sont disponibles." : "Terminal connecté, mais aucun symbole Gold/USD compatible détecté.");
  });
  const canLoad = !busy && status?.connected === true && status.symbols.some(s => s.name === symbol);
  const maxWarmup = barsIn7Days[timeframe] - 2;
  const load = () => {
    if (!canLoad) { setError("Détectez MT5 puis sélectionnez un symbole Gold/USD réellement détecté. Le dernier lot chargé reste conservé."); return; }
    const startISO = frenchDateToISO(startDate), endISO = frenchDateToISO(endDate);
    if (!startISO || !endISO) { setError("Dates invalides. Utilisez JJ/MM/AAAA, par exemple 05/10/2026, avec un jour réellement existant."); return; }
    const start = Date.parse(`${startISO}T00:00:00Z`), end = Date.parse(`${endISO}T00:00:00Z`) + 86400000;
    if (start >= end || end > Date.now()) { setError("Choisissez des journées UTC passées ; la fin est incluse et aujourd’hui est exclu."); return; }
    if (!Number.isInteger(warmup) || warmup < 0 || warmup > maxWarmup) { setError(`Préchauffage entier de 0 à ${maxWarmup} bougies pour ${timeframe}, recherché sur les 7 jours précédents.`); return; }
    void action("history", async signal => {
      const token = crypto.randomUUID(); tokenRef.current = token;
      setProgress(0);
      let stopped = false;
      let pollTimer: number | undefined;
      const poll = async () => {
        try {
          const result = await adapter.progress(token, signal);
          if (!stopped && mounted.current) setProgress(result.progress);
        } catch { /* The history request supplies errors; polling is informational only. */ }
        if (!stopped && !signal.aborted) pollTimer = window.setTimeout(() => void poll(), 500);
      };
      pollTimer = window.setTimeout(() => void poll(), 500);
      try {
        const data = await adapter.fetchRange({ terminalPath, symbol, timeframe, start: new Date(start).toISOString(), end: new Date(end).toISOString(), warmup, token }, signal);
        if (signal.aborted || cancelled.current || !mounted.current) return;
        setProgress(100);
        updateSession({ history: data });
        setMessage(`Bougies MT5 ${timeframe} conservées en mémoire. Aucun backtest n’a été lancé.`);
      } finally {
        stopped = true;
        window.clearTimeout(pollTimer);
      }
    });
  };
  const samples = history ? [...new Map([...history.candles.slice(0, 2), ...history.candles.slice(-2)].map(c => [c.time, c])).values()] : [];
  return <Section title="Données historiques · MetaTrader 5 en lecture seule" description="MT5DataAdapter en lecture seule, basé sur le package Python officiel MetaTrader5. Aucun ordre réel, aucun trading live, aucune clé API. Le terminal Windows et le serveur local TradeBot IA doivent fonctionner sur le même PC.">
    <div className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><p className="text-sm leading-relaxed">Chargez et exportez les bougies M1, M5 ou M15 des symboles Gold/USD détectés. Chaque stratégie utilise son propre timeframe : M1 pour Scalping M1, M5 pour Scalping M5. Aucune conversion M1 vers M5. Twelve Data et la stratégie H1 restent inchangés. Aucun chargement ne lance un backtest.</p></div>
    <div className="space-y-4">
      <Field label="Chemin du terminal MT5 (facultatif)" hint="Laissez vide pour la détection officielle. Si plusieurs terminaux sont installés, copiez le chemin absolu de votre véritable terminal64.exe, visible dans les propriétés de son raccourci."><Input disabled={!!busy} value={terminalPath} onChange={e => { updateSession({ terminalPath: e.target.value, status: null, symbol: "" }); }} placeholder="Chemin local vers terminal64.exe, si nécessaire" className="h-11 rounded-xl bg-background/50" /></Field>
      <div className="flex flex-wrap gap-3"><Button type="button" disabled={!!busy} onClick={detect} className={`${actionClass} bg-primary text-primary-foreground hover:bg-primary/90`}>{busy === "status" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plug className="mr-2 h-4 w-4" />}Détecter MT5 & Gold</Button><Button type="button" disabled={!!busy} variant="outline" className={actionClass} onClick={() => {
        if (!window.confirm("Installer le package Python officiel gratuit MetaTrader5 et ses dépendances depuis PyPI dans votre Python local ? Cela ne connecte aucun compte et n’envoie aucun ordre.")) return;
        void action("install", async signal => { const result = await adapter.installOfficialPackage(signal); setMessage(`${result.message} Python détecté : ${result.pythonVersion}.`); });
      }}>{busy === "install" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Installer le connecteur officiel gratuit</Button></div>
      {status && <div className="space-y-3 rounded-xl border border-border bg-background/40 p-4"><p className="text-sm font-semibold text-primary">Connecté en lecture seule · {status.terminalName} · package {status.packageVersion}</p><p className="text-xs text-muted-foreground">Barres maximum annoncées par le terminal : {status.maxBars.toLocaleString("fr-FR")}.</p><Field label="Symbole Gold/USD détecté"><select disabled={!!busy} className={selectClass} value={symbol} onChange={e => { updateSession({ symbol: e.target.value }); }}><option value="" disabled>{status.symbols.length ? "Sélectionnez une variante détectée" : "Aucun Gold/USD disponible"}</option>{status.symbols.map(s => <option key={s.name} value={s.name}>{s.name} · {s.description}</option>)}</select></Field>{status.symbols.find(s => s.name === symbol) && <p className="text-xs text-muted-foreground">Identification : {status.symbols.find(s => s.name === symbol)!.reason}. Les contrats à expiration sont exclus ; le symbole reste celui du broker.</p>}{status.warnings.map((w, i) => <p key={i} className="text-xs text-muted-foreground">{w}</p>)}</div>}
    </div>
    <form noValidate onSubmit={e => { e.preventDefault(); load(); }} className="space-y-4 rounded-xl border border-border p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Database className="h-4 w-4 text-primary" />Demander des bougies {timeframe} · TIMEFRAME_{timeframe}</h3>
      <fieldset disabled={!!busy} className="grid gap-4 sm:grid-cols-2 disabled:opacity-60">
        <Field label="Timeframe MT5"><select disabled={!!fixedTimeframe} className={selectClass} value={timeframe} onChange={e => setTimeframe(e.target.value as MT5Timeframe)}><option value="M1">M1 · 1 minute</option><option value="M5">M5 · 5 minutes</option><option value="M15">M15 · 15 minutes</option></select></Field>
        <NumberField label="Bougies réelles de préchauffage demandées" hint={`Maximum ${maxWarmup} pour ${timeframe}, sur les 7 jours précédents. Ne modifie aucun réglage de stratégie.`} value={warmup} min={0} max={maxWarmup} onChange={value => updateSession({ warmup: value })} />
        <Field label="Début UTC · JJ/MM/AAAA"><Input type="text" inputMode="numeric" placeholder="JJ/MM/AAAA" value={startDate} onChange={e => updateSession({ startDate: maskDate(e.target.value) })} className="h-11 rounded-xl bg-background font-mono" /></Field>
        <Field label="Fin UTC incluse · JJ/MM/AAAA"><Input type="text" inputMode="numeric" placeholder="JJ/MM/AAAA" value={endDate} onChange={e => updateSession({ endDate: maskDate(e.target.value) })} className="h-11 rounded-xl bg-background font-mono" /></Field>
      </fieldset>
      <p className="text-xs text-muted-foreground">Lecture par lots de 5 000 intervalles maximum, sans plafond global de 5 000 bougies. La profondeur disponible dépend du broker et du terminal.</p>
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={!canLoad} className={`${actionClass} bg-primary text-primary-foreground hover:bg-primary/90`}>{busy === "history" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}{fixedTimeframe === "M5" ? "Charger les données M5" : `Charger les bougies MT5 ${timeframe}`}</Button>{busy === "history" && <Button type="button" variant="outline" disabled={cancelling} onClick={() => void cancelLoad()} className={actionClass}>{cancelling ? "Annulation…" : "Annuler le chargement"}</Button>}</div>
      {busy === "history" && <div className="space-y-2 rounded-xl bg-primary/5 p-3"><p role="status" className="text-xs">Lecture des lots : {progress} % · validation avant remplacement du lot précédent</p><Progress value={progress} aria-label="Progression du chargement MT5" className="h-2 rounded-full bg-primary/15 [&>div]:bg-primary" /></div>}
    </form>
    {busy && <p role="status" className="text-sm text-muted-foreground">{busy === "install" ? "Installation officielle sur clic confirmé, quelques minutes possibles…" : "Lecture locale MT5 en cours…"} Aucune requête ni installation automatique en arrière-plan.</p>}
    {message && <p role="status" className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm">{message}</p>}
    {error && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}{history && " Le chargement précédent affiché ci-dessous reste associé à ses propres dates."}</p>}
    {history && <div className="space-y-3 rounded-xl border border-primary/25 bg-background/40 p-4">
      <h3 className="text-sm font-semibold">Données réelles MT5 · {history.symbol} · {history.apiTimeframe.replace("TIMEFRAME_", "")} · prix {history.priceBasis}</h3>
      <Button type="button" variant="outline" className={actionClass} disabled={!history.candles.length} onClick={() => {
        const loadedTimeframe = history.apiTimeframe.replace("TIMEFRAME_", "");
        exportCSV(`MT5_${history.symbol.replace(/[^a-zA-Z0-9_-]/g, "_")}_${loadedTimeframe}.csv`, ["date_utc", "open", "high", "low", "close", "tick_volume"], history.candles.map(c => [new Date(c.time).toISOString(), c.open, c.high, c.low, c.close, c.volume]));
        setMessage(`${history.candles.length} bougies ${loadedTimeframe} exportées en CSV, préchauffage et volumes de ticks inclus. Aucun appel MT5 ni calcul.`);
      }}><Download className="mr-2 h-4 w-4" />Exporter le lot MT5 complet en CSV</Button>
      <p className="text-xs text-muted-foreground">Export intégral du lot déjà chargé : date d’ouverture UTC, OHLC et volume de ticks, préchauffage inclus, sans interpolation ni nouvelle requête.</p>
      <p className="text-xs text-muted-foreground">Dernier lot réussi conservé en mémoire et partagé avec le backtest Scalping. Modifier les champs ou refaire une détection ne l’efface pas ; seuls de nouveaux résultats de chargement réussis le remplacent. Le backtest utilise les dates de ce lot, pas celles d’une demande non chargée. Cette mémoire est conservée lors de la navigation dans l’application, mais pas après un rechargement du navigateur.</p>
      <p className="text-xs text-muted-foreground">Demandé : {mt5FrenchUTC(history.coverage.requestedStart)} → {mt5FrenchUTC(history.coverage.requestedEnd)} (fin exclusive). Récupéré le {mt5FrenchUTC(history.fetchedAt)}.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["Bougies retournées", history.candles.length], ["Préchauffage réel", history.coverage.warmupCount], ["Bougies de la période", history.coverage.testedCount], ["Minutes absentes sur la plage", history.coverage.missingMinutes]].map(([label, value]) => <div key={label} className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-xl text-primary">{value}</p></div>)}</div>
      <p className="text-xs">Mois : {new Date(history.coverage.requestedStart).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" })} · Première ouverture de la période : {mt5FrenchUTC(history.coverage.first)} · dernière : {mt5FrenchUTC(history.coverage.last)}.</p>
      <div className="overflow-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead><tr>{["Ouverture UTC", "Open", "High", "Low", "Close", "Volume de ticks"].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{samples.map(c => <tr key={c.time} className="border-t border-border"><td className="p-2">{mt5FrenchUTC(c.time)}</td>{[c.open, c.high, c.low, c.close].map((p, i) => <td key={i} className="p-2 font-mono">{price(p)}</td>)}<td className="p-2 font-mono">{c.volume}</td></tr>)}</tbody></table></div>
      {history.coverage.gapCount > 0 && <details><summary className="cursor-pointer text-xs text-primary">Intervalles sans bougie : {history.coverage.gapCount} (30 maximum affichés)</summary><ul className="mt-2 space-y-1 text-xs">{history.coverage.gaps.map((g, i) => <li key={i}>{mt5FrenchUTC(g.from)} → {mt5FrenchUTC(g.to)} · {g.minutes} minute(s), fin exclue</li>)}</ul></details>}
      <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">{history.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
    </div>}
    <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-semibold">À préparer sur votre PC · aucune clé API ni carte bancaire</summary><ol className="mt-3 list-decimal space-y-2 pl-5 text-xs leading-relaxed text-muted-foreground"><li>Windows 64 bits : installez le terminal MetaTrader 5 de votre broker et Python 3.12 64 bits depuis python.org. Cochez le lanceur Python et « Add Python to PATH » pendant l’installation.</li><li>Ouvrez MT5 et connectez-vous dans le terminal avec votre propre compte, idéalement démo. Laissez le terminal ouvert. TradeBot IA ne demande ni n’enregistre vos identifiants MT5.</li><li>Gardez « Algo Trading » désactivé. Dans les options de MT5, le réglage « Désactiver le trading automatique via l’API Python externe », s’il est présent, peut rester coché : ce pont ne demande que la lecture.</li><li>Cliquez une seule fois sur « Installer le connecteur officiel gratuit » si le package manque, puis sur « Détecter MT5 & Gold ». Aucun abonnement de données de cette application n’est ajouté ; l’accès à Gold et la profondeur d’historique dépendent de votre broker.</li><li>Si nécessaire, ouvrez un graphique Gold M1 dans MT5 et chargez les anciennes barres via son interface. Vérifiez « Outils → Options → Graphiques → Barres max dans le graphique ». Le chargement peut ajouter le symbole à l’Observation du marché, mais ne passe aucun ordre.</li><li>Choisissez le symbole détecté, une plage JJ/MM/AAAA et cliquez sur « Charger les données {timeframe} ». Le serveur TradeBot IA doit être local sur ce même PC, pas hébergé sur un autre serveur.</li></ol></details>
  </Section>;
}
