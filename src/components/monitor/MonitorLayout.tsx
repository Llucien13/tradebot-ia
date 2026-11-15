import { createContext, useContext, useEffect, useState } from "react";
import { Activity, ArrowUpRight, BarChart3, BookOpen, CalendarDays, Home, Radio, ShieldCheck, Target } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { readMonitor, type MonitorData } from "@/lib/paper-monitor-api";
import { RELEASE } from "@/release";

const Context = createContext<{ data: MonitorData | null; fresh: boolean; connected: boolean; now: number }>({ data: null, fresh: false, connected: false, now: 0 });
export const useMonitor = () => useContext(Context);
const links = [
  { to: "/", label: "Accueil", icon: Home }, { to: "/positions", label: "Positions", icon: Target },
  { to: "/journal-paper", label: "Journal", icon: BookOpen }, { to: "/calendrier-paper", label: "Calendrier", icon: CalendarDays },
  { to: "/statistiques", label: "Statistiques", icon: BarChart3 },
  { to: "/etat", label: "État", icon: Activity },
];
export const statusLabels = { RUNNING: "Surveillance en cours", WAITING_QUOTES: "En attente de cotations fraîches", WAITING_MARKET: "Marché fermé · position conservée", SAFE_STOP: "SAFE_STOP · intervention requise", STOPPED: "Essai arrêté" };

export default function MonitorLayout() {
  const query = useQuery({ queryKey: ["paper-monitor-v86"], queryFn: ({ signal }) => readMonitor(signal),
    refetchInterval: 4000, refetchIntervalInBackground: false, retry: false });
  const [now, setNow] = useState(Date.now()/1000);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()/1000), 1000); return () => window.clearInterval(id); }, []);
  const data = query.data?.ready ? query.data : null;
  const connected = !query.isError && !!data && now-data.observedAt >= -2 && now-data.observedAt <= 12 && !data.observerError;
  const fresh = connected && !!data?.fresh && !!data.quote && [data.quote.time, data.quote.fxTime, data.health.worker.heartbeat].every(t => t != null && now-t >= 0 && now-t <= 15);
  const message = query.isError ? query.error.message : query.data?.observerError ?? (!query.isPending && !connected ? "L’observation est ancienne. Aucune valorisation actuelle n’est certifiée." : data?.status === "RUNNING" && !fresh ? "Le moteur déclare une session lancée, mais sa valorisation ou son heartbeat ne sont pas actuellement certifiables. Consultez État." : "");
  return <Context.Provider value={{ data, connected, fresh, now }}><div className="min-h-screen bg-slate-950 text-slate-100 [--muted-foreground:215_20%_72%]">
    <header className="border-b border-slate-800 bg-slate-900/80">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <Link to="/" className="flex items-center gap-3"><span className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-cyan-300"><Radio size={22} /></span><span><span className="block text-lg font-semibold tracking-tight">TradeBot IA<span className="ml-2 text-xs font-normal text-slate-400">{RELEASE}</span></span><span className="text-xs tracking-widest text-slate-400">MONITORING PRO</span></span></Link>
        <div className="flex flex-wrap items-center gap-3"><span className="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-[11px] font-semibold text-emerald-300"><ShieldCheck size={14} />LIVE OFF — AUCUN ORDRE MT5</span><Button asChild variant="ghost" className="min-h-11 rounded-xl text-xs text-slate-300"><Link to="/v85">Espace V85<ArrowUpRight size={14} className="ml-1" /></Link></Button></div>
      </div>
      <nav aria-label="Monitoring principal" className="mx-auto hidden max-w-7xl gap-2 px-8 pb-3 sm:flex">{links.map(item => <NavLink end={item.to === "/"} key={item.to} to={item.to} className={({ isActive }) => `flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm ${isActive ? "bg-slate-800 text-cyan-300" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}><item.icon size={16} />{item.label}</NavLink>)}</nav>
    </header>
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 pb-32 sm:px-8 sm:pb-10">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400"><span>GOLD / XAUUSD · M15 · 2,5R · risque ≤ 0,5 %</span><span>{connected ? "Bridge actif · lecture seule" : "Bridge / observation non confirmé"} · actualisation 4 s</span></div>
      {query.isPending && <p role="status" className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-sm">Connexion au registre PAPER de votre PC… Aucun exemple de trade n’est affiché.</p>}
      {message && <div role="alert" className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm leading-relaxed text-amber-100"><p>{message}</p><p className="mt-2 text-xs">Les données conservées ci-dessous sont des dernières observations, pas une confirmation de fonctionnement actuel.</p><Button variant="outline" className="mt-3 min-h-11 rounded-xl border-amber-400/30 bg-transparent" disabled={query.isFetching} onClick={() => void query.refetch()}>Réessayer la connexion</Button></div>}
      {data?.status === "SAFE_STOP" && <div role="alert" className="rounded-2xl border border-rose-400/40 bg-rose-400/10 p-4 text-sm text-rose-200"><strong>SAFE_STOP — moteur sécurisé</strong><p className="mt-2 break-words">{data.health.storageFault || data.health.error || data.health.worker.cause || "Consultez l’état du moteur."}</p></div>}
      {data?.status === "WAITING_QUOTES" && <div role="status" className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-100"><strong>En attente de cotations fraîches</strong><p className="mt-2 break-words">{data.health.waitingReason || "Cotation temporairement inexploitable."}</p><p className="mt-2 text-xs">Aucun trade sur données périmées. Reprise gérée par la V85 ; une interruption avec position peut nécessiter une reprise explicite.</p></div>}
      <Outlet />
      <footer className="space-y-2 border-t border-slate-800 pt-5 text-xs leading-relaxed text-slate-400"><p>Monitoring en lecture seule · source : registre ESSAI PAPER indépendant · aucune décision de stratégie ajoutée.</p><p>iPhone à distance : Bureau à distance Google conservé. Aucun port public, tunnel ou accès Internet activé.</p><p><Link className="text-cyan-300 underline underline-offset-4" to="/etat">Santé, notifications et accès mobile</Link> · <Link className="underline underline-offset-4" to="/v85">Commandes manuelles et espace V85 conservés</Link></p></footer>
    </main>
    <nav aria-label="Navigation mobile monitoring" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-700 bg-slate-900 px-1 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:hidden">{links.map(item => <NavLink end={item.to === "/"} key={item.to} to={item.to} className={({ isActive }) => `flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[10px] ${isActive ? "bg-slate-800 text-cyan-300" : "text-slate-300"}`}><item.icon size={20} /><span>{item.label}</span></NavLink>)}</nav>
  </div></Context.Provider>;
}
