import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Activity, Cloud, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  clearCloudPaperSession,
  readCloudMonitorJournal,
  readCloudMonitorState,
  readCloudPaperSession,
  signInCloudPaper,
  type CloudPaperSession,
} from "@/lib/cloud-paper-api";
import type { CloudMonitorTrade } from "@/lib/cloud-monitor-model";

const money = (value: number | null | undefined) => value == null || !Number.isFinite(value)
  ? "—"
  : new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);

const date = (value: number | string | null | undefined) => {
  if (value == null) return "—";
  const timestamp = typeof value === "number" ? value * 1000 : Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("fr-FR") : "—";
};

const statusLabel: Record<string, string> = {
  RUNNING: "Surveillance en cours",
  WAITING_QUOTES: "En attente de cotations",
  WAITING_MARKET: "Marché fermé",
  SAFE_STOP: "SAFE_STOP",
  STOPPED: "Arrêté",
};

export default function CloudMonitorPage() {
  const [session, setSession] = useState<CloudPaperSession | null>(null);
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof readCloudMonitorState>> | null>(null);
  const [journal, setJournal] = useState<Awaited<ReturnType<typeof readCloudMonitorJournal>> | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);

  const refresh = useCallback(async (activeSession: CloudPaperSession, pageOffset = offset) => {
    setBusy(true);
    try {
      const [state, trades] = await Promise.all([
        readCloudMonitorState(activeSession),
        readCloudMonitorJournal(activeSession, pageOffset, 50),
      ]);
      setSnapshot(state);
      setJournal(trades);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Lecture du monitoring Cloud impossible.");
      if (reason instanceof Error && reason.message.includes("Session Cloud expirée")) setSession(null);
    } finally {
      setBusy(false);
    }
  }, [offset]);

  useEffect(() => {
    let active = true;
    void readCloudPaperSession().then(stored => {
      if (active && stored) setSession(stored);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : "Vérification de la session Cloud impossible.");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!session) return;
    void refresh(session, offset);
    const timer = window.setInterval(() => { void refresh(session, offset); }, 15000);
    return () => window.clearInterval(timer);
  }, [session, offset, refresh]);

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

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      await clearCloudPaperSession();
      setSession(null);
      setSnapshot(null);
      setJournal(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Déconnexion Cloud impossible.");
    } finally {
      setBusy(false);
    }
  }

  const syncedAt = snapshot?.syncedAt ? Date.parse(snapshot.syncedAt) : NaN;
  const syncAge = Number.isFinite(syncedAt) ? Date.now() - syncedAt : null;
  const connectorOnline = syncAge !== null && syncAge >= 0 && syncAge <= 60000;
  const data = snapshot?.snapshot ?? null;
  const equity = data?.floatingEUR == null ? null : data.metrics.balance + data.floatingEUR;

  return <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-8">
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div className="flex items-center gap-3">
          <span className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-cyan-300"><Cloud size={22} /></span>
          <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">TradeBot IA</p><h1 className="mt-1 text-2xl font-semibold">Monitoring PAPER Cloud</h1></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-[11px] font-semibold text-emerald-300"><ShieldCheck size={14} />LIVE OFF · LECTURE SEULE</span>
          {session && <Button variant="ghost" onClick={signOut}><LogOut size={15} />Déconnexion</Button>}
        </div>
      </header>

      <p className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm leading-relaxed text-slate-300">
        Données envoyées par le connecteur local V86 vers une API Cloud authentifiée. Aucune commande MT5 n’est exposée. La synchronisation nécessite que le PC et la passerelle locale soient actifs.
      </p>
      {error && <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/5 p-4 text-sm text-rose-200">{error}</p>}

      {!session ? <form onSubmit={login} className="mx-auto max-w-lg space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-7">
        <h2 className="text-lg font-semibold">Connexion au compte Cloud</h2>
        <label className="block text-sm text-slate-300">E-mail<input required type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3" /></label>
        <label className="block text-sm text-slate-300">Mot de passe<input required type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3" /></label>
        <Button type="submit" disabled={busy} className="min-h-11 w-full">{busy ? "Connexion…" : "Se connecter"}</Button>
      </form> : <>
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Solde virtuel", money(data?.metrics.balance)],
            ["Equity observée", money(equity)],
            ["P&L réalisé", money(data?.metrics.realized)],
            ["Position ouverte", data?.position ? `${data.position.side === 1 ? "Achat" : "Vente"} XAUUSD · ${money(data.position.netPositionEUR)}` : "Aucune"],
          ].map(([label, value]) => <article key={label} className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><p className="text-xs text-slate-400">{label}</p><p className="mt-2 text-lg font-semibold tabular-nums">{value}</p></article>)}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold"><Activity size={18} className="text-cyan-300" />État de la connexion</h2>
            <Button variant="outline" onClick={() => void refresh(session, offset)} disabled={busy}><RefreshCw size={15} className={busy ? "animate-spin" : ""} />Actualiser</Button>
          </div>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-xs text-slate-400">Connecteur PC</dt><dd className={connectorOnline ? "mt-1 text-emerald-300" : "mt-1 text-amber-200"}>{connectorOnline ? "Synchronisation récente" : "Aucune synchronisation récente"}</dd></div>
            <div><dt className="text-xs text-slate-400">Dernière synchronisation Cloud</dt><dd className="mt-1">{date(snapshot?.syncedAt)}</dd></div>
            <div><dt className="text-xs text-slate-400">Dernière observation PC</dt><dd className="mt-1">{date(data?.observedAt)}</dd></div>
            <div><dt className="text-xs text-slate-400">MT5 / moteur PAPER</dt><dd className="mt-1">{data ? `${data.health.mt5} · ${statusLabel[data.status]}` : "Aucune donnée reçue"}</dd></div>
          </dl>
          {data && (!data.fresh || data.health.storageFault || syncAge == null || syncAge > 60000) && <p role="status" className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-100">Données absentes ou périmées : cette vue ne certifie pas un état MT5 temps réel.</p>}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="font-semibold">Journal PAPER local synchronisé</h2>
          {!journal?.items.length ? <p className="mt-4 text-sm text-slate-400">Aucune transaction présente dans le journal source.</p> : <div className="mt-4 space-y-3">
            {journal.items.map((item: CloudMonitorTrade) => <article key={item.id} className="grid gap-2 rounded-xl border border-slate-700 bg-slate-950/60 p-4 text-sm sm:grid-cols-4">
              <div><p className="text-xs text-slate-400">Sens / statut</p><p className="mt-1">{item.trade.side === 1 ? "Achat" : "Vente"} · {item.trade.exitTime == null ? item.needsReview ? "À vérifier" : "Ouverte" : "Clôturée"}</p></div>
              <div><p className="text-xs text-slate-400">Entrée / sortie</p><p className="mt-1 tabular-nums">{item.trade.entry} / {item.trade.exit ?? "—"}</p></div>
              <div><p className="text-xs text-slate-400">P&L / risque</p><p className="mt-1 tabular-nums">{money(item.trade.pnl)} / {money(item.trade.riskEUR)}</p></div>
              <div><p className="text-xs text-slate-400">Date</p><p className="mt-1">{date(item.trade.exitTime ?? item.trade.entryTime)}</p></div>
            </article>)}
          </div>}
          <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
            <Button variant="outline" disabled={offset === 0 || busy} onClick={() => setOffset(Math.max(0, offset - 50))}>Précédent</Button>
            <span>{journal ? `${journal.total ? offset + 1 : 0}–${Math.min(offset + 50, journal.total)} / ${journal.total}` : "—"}</span>
            <Button variant="outline" disabled={!journal || offset + 50 >= journal.total || busy} onClick={() => setOffset(offset + 50)}>Suivant</Button>
          </div>
        </section>
      </>}
    </div>
  </main>;
}
