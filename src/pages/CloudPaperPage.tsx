import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Activity, Cloud, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  clearCloudPaperSession,
  readCloudPaperJournal,
  readCloudPaperSession,
  readCloudPaperState,
  setCloudPaperRunning,
  setupCloudPaper,
  signInCloudPaper,
  type CloudPaperSession,
  type CloudPaperSnapshot,
} from "@/lib/cloud-paper-api";
import { PAPER_CAPITAL_OPTIONS, PAPER_DEFAULT_CAPITAL, paperCapitalSchema, readTrendMaster } from "@/lib/paper/model";

type CloudEvent = Awaited<ReturnType<typeof readCloudPaperJournal>>[number];
const emptyCosts = { initialCapital: String(PAPER_DEFAULT_CAPITAL), spread: "", slippage: "", commission: "", contractSize: "", minLot: "", lotStep: "", leverage: "" };

function formatMoney(value: number | null | undefined) {
  return value == null || !Number.isFinite(value)
    ? "—"
    : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);
}

function formatDate(value: string | number | null | undefined) {
  if (value == null) return "—";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

export default function CloudPaperPage() {
  const [session, setSession] = useState<CloudPaperSession | null>(null);
  const [snapshot, setSnapshot] = useState<CloudPaperSnapshot | null>(null);
  const [journal, setJournal] = useState<CloudEvent[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [costs, setCosts] = useState(emptyCosts);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const cycleAgeMs = snapshot?.lastCycleAt ? Date.now() - Date.parse(snapshot.lastCycleAt) : null;
  const cycleFresh = cycleAgeMs !== null && cycleAgeMs >= 0 && cycleAgeMs <= 90 * 60 * 1000;

  const refresh = useCallback(async (activeSession: CloudPaperSession) => {
    setRefreshing(true);
    try {
      const [nextSnapshot, nextJournal] = await Promise.all([
        readCloudPaperState(activeSession),
        readCloudPaperJournal(activeSession),
      ]);
      setSnapshot(nextSnapshot);
      setJournal(nextJournal);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Lecture du Cloud PAPER impossible.");
      if (reason instanceof Error && reason.message.includes("Session Cloud expirée")) setSession(null);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const stored = readCloudPaperSession();
    if (stored) setSession(stored);
  }, []);

  useEffect(() => {
    if (!session) {
      setSnapshot(null);
      setJournal([]);
      return;
    }
    let active = true;
    const load = async () => {
      if (!active) return;
      await refresh(session);
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [session, refresh]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setSession(await signInCloudPaper(email.trim(), password));
      setPassword("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Connexion Cloud impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function configure(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const strategy = readTrendMaster();
      const account = {
        initialCapital: paperCapitalSchema.parse(Number(costs.initialCapital)),
        spread: Number(costs.spread),
        slippage: Number(costs.slippage),
        commission: Number(costs.commission),
        contractSize: Number(costs.contractSize),
        minLot: Number(costs.minLot),
        lotStep: Number(costs.lotStep),
        leverage: Number(costs.leverage),
      };
      const result = await setupCloudPaper(session, account, strategy);
      setNotice(`Compte Cloud créé à ${formatMoney(result.initialCapital)}. Le moteur reste arrêté jusqu’au démarrage manuel.`);
      await refresh(session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Configuration Cloud PAPER impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function control(running: boolean) {
    if (!session || snapshot?.revision == null) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await setCloudPaperRunning(session, running, snapshot.revision);
      setNotice(running ? "PAPER Cloud démarré. LIVE reste désactivé." : "Nouvelles entrées PAPER mises en pause.");
      await refresh(session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Commande Cloud PAPER refusée.");
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    clearCloudPaperSession();
    setSession(null);
    setSnapshot(null);
    setJournal([]);
  }

  return <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-8">
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div className="flex items-center gap-3">
          <span className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-cyan-300"><Cloud size={22} /></span>
          <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">TradeBot IA</p><h1 className="mt-1 text-2xl font-semibold">PAPER Cloud</h1></div>
        </div>
        <span className="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-[11px] font-semibold text-emerald-300"><ShieldCheck size={14} />LIVE OFF · AUCUN ORDRE RÉEL</span>
      </header>

      <p className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm leading-relaxed text-slate-300">
        Cette interface utilise une session personnelle et le journal distant. Le capital principal proposé est de 20 000 €; 45 000 € est disponible comme capital alternatif pour un compte distinct. Le moteur reste arrêté tant qu’il n’est pas démarré explicitement. Les stratégies locales existantes ne sont pas modifiées.
      </p>

      {error && <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/5 p-4 text-sm text-rose-200">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-cyan-400/30 bg-cyan-400/5 p-4 text-sm text-cyan-100">{notice}</p>}

      {!session ? <form onSubmit={login} className="mx-auto max-w-lg space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-7">
        <h2 className="text-lg font-semibold">Connexion au compte Cloud</h2>
        <p className="text-sm text-slate-400">Le compte d’accès doit être créé dans le fournisseur d’authentification choisi. Le mot de passe n’est pas enregistré par cette application.</p>
        <label className="block text-sm text-slate-300">E-mail<input required type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3" /></label>
        <label className="block text-sm text-slate-300">Mot de passe<input required type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3" /></label>
        <Button type="submit" disabled={busy} className="min-h-11 w-full rounded-xl">{busy ? "Connexion…" : "Se connecter"}</Button>
      </form> : <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-300"><Activity size={16} className={snapshot?.running && cycleFresh ? "text-emerald-300" : "text-amber-300"} />{snapshot?.running && cycleFresh ? "Dernier cycle cloud récent" : snapshot?.running ? "Cycle cloud ancien ou non confirmé" : "Moteur arrêté ou en attente de configuration"}</div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={refreshing || busy} onClick={() => void refresh(session)} className="min-h-11 rounded-xl border-slate-700 bg-transparent"><RefreshCw size={15} className={`mr-2 ${refreshing ? "animate-spin" : ""}`} />Actualiser</Button>
            <Button variant="outline" onClick={signOut} className="min-h-11 rounded-xl border-slate-700 bg-transparent"><LogOut size={15} className="mr-2" />Quitter</Button>
          </div>
        </div>

        {snapshot?.configured && snapshot.state?.account ? <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Capital initial", formatMoney(snapshot.state.account.initialCapital)],
              ["Solde PAPER", formatMoney(snapshot.state.cash)],
              ["P&L réalisé", formatMoney(snapshot.state.cash! - snapshot.state.account.initialCapital)],
              ["Trades clôturés", String(snapshot.state.trades.length)],
              ["Position ouverte", snapshot.state.position ? snapshot.state.position.direction : "Aucune"],
            ].map(([label, value]) => <div key={label} className="rounded-2xl border border-slate-800 bg-slate-900 p-4"><p className="text-xs text-slate-400">{label}</p><p className="mt-2 text-xl font-semibold tabular-nums">{value}</p></div>)}
          </section>
          {snapshot.state.position && <section className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-5">
            <h2 className="font-semibold">Position PAPER ouverte</h2>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              {[["Entrée", snapshot.state.position.entry], ["Stop-loss", snapshot.state.position.sl], ["Take-profit", snapshot.state.position.tp], ["Volume", `${snapshot.state.position.lots} lot(s)`], ["Risque initial", formatMoney(snapshot.state.position.riskMoney)], ["Ouverture", formatDate(snapshot.state.position.entryTime)]].map(([label, value]) => <div key={label}><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-1 font-mono">{value}</dd></div>)}
            </dl>
          </section>}
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <div><h2 className="font-semibold">{snapshot.strategy?.name ?? "Stratégie"}</h2><p className="mt-1 text-sm text-slate-400">XAU/USD · 1h / 4h · révision {snapshot.revision}</p><p className="mt-1 text-xs text-slate-500">Dernier cycle serveur validé : {formatDate(snapshot.lastCycleAt)} · dernières bougies : {formatDate(snapshot.state.fetchedAt)}</p></div>
            <Button disabled={busy} onClick={() => void control(!snapshot.running)} className={`min-h-11 rounded-xl ${snapshot.running ? "border border-slate-600 bg-slate-800 text-white" : ""}`}>
              {snapshot.running ? "Pause des nouvelles entrées" : "Démarrer PAPER Cloud"}
            </Button>
          </section>
          {snapshot.state.position && <p role="status" className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-100">Une position PAPER est ouverte. Une pause bloque les nouvelles entrées mais le cycle cloud continue à gérer cette position.</p>}
        </> : !snapshot ? <p role="status" className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-300">Chargement de l’état Cloud…</p> : <form onSubmit={configure} className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-7">
          <div><h2 className="text-lg font-semibold">Créer le compte PAPER Cloud</h2><p className="mt-1 text-sm text-slate-400">Capital initial : 20 000 € par défaut. 45 000 € est disponible pour créer un compte PAPER distinct. Entrez les spécifications et frais vérifiés auprès du fournisseur; aucune valeur de contrat n’est préremplie.</p></div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm text-slate-300">Capital initial (€)<select required value={costs.initialCapital} onChange={event => setCosts(previous => ({ ...previous, initialCapital: event.target.value }))} className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 font-mono">{PAPER_CAPITAL_OPTIONS.map(capital => <option key={capital} value={capital}>{formatMoney(capital)}</option>)}</select></label>
            {([
              ["spread", "Spread XAU/USD (USD/oz)"],
              ["slippage", "Slippage simulé (USD/oz/sens)"],
              ["commission", "Commission (USD/oz/sens)"],
              ["contractSize", "Taille du contrat (oz/lot)"],
              ["minLot", "Volume minimum (lot)"],
              ["lotStep", "Pas de volume (lot)"],
              ["leverage", "Levier de simulation"],
            ] as const).map(([key, label]) => <label key={key} className="text-sm text-slate-300">{label}<input required type="number" step="any" min={key === "slippage" || key === "commission" ? "0" : "0.00000001"} value={costs[key]} onChange={event => setCosts(previous => ({ ...previous, [key]: event.target.value }))} className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 font-mono" /></label>)}
          </div>
          <Button type="submit" disabled={busy} className="min-h-11 rounded-xl">{busy ? "Vérification et création…" : "Créer le compte (moteur arrêté)"}</Button>
        </form>}

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-lg font-semibold">Journal Cloud</h2>
          <p className="mt-1 text-sm text-slate-400">Signaux et événements de position persistés côté serveur.</p>
          {!journal.length ? <p className="mt-4 rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">Aucun événement Cloud PAPER enregistré.</p> : <ol className="mt-4 divide-y divide-slate-800">{journal.map(item => <CloudJournalItem key={item.event_id} item={item} />)}</ol>}
        </section>
      </>}
      <footer className="border-t border-slate-800 pt-4 text-xs leading-relaxed text-slate-500">PAPER uniquement. Aucune route d’ordre broker n’est appelée. L’accès mobile requiert un déploiement HTTPS, une session dédiée et la configuration serveur des secrets.</footer>
    </div>
  </main>;
}

function CloudJournalItem({ item }: { item: CloudEvent }) {
  const payload = item.payload as { direction?: string; pnl?: number; entry?: number; exit?: number; lots?: number; name?: string; sl?: number; tp?: number; initialSL?: number; initialTP?: number };
  return <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
    <div><p className="text-sm font-medium">{item.event_type.replace(/_/g, " ")}{payload.direction ? ` · ${payload.direction}` : ""}{payload.name ? ` · ${payload.name}` : ""}</p><p className="mt-1 text-xs text-slate-400">{formatDate(item.occurred_at)}{payload.lots != null ? ` · ${payload.lots} lot(s)` : ""}{payload.entry != null ? ` · entrée ${payload.entry}` : ""}{payload.exit != null ? ` · sortie ${payload.exit}` : ""}{(payload.sl ?? payload.initialSL) != null ? ` · SL ${payload.sl ?? payload.initialSL}` : ""}{(payload.tp ?? payload.initialTP) != null ? ` · TP ${payload.tp ?? payload.initialTP}` : ""}</p></div>
    {payload.pnl != null && <span className={`font-semibold tabular-nums ${payload.pnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{formatMoney(payload.pnl)}</span>}
  </li>;
}
