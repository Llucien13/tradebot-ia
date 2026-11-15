import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { z } from "zod";
import { Bot, ShieldCheck } from "lucide-react";
import { AppNavigation } from "@/components/navigation/AppNavigation";
import type { FTMOCosts, FTMOWorkspace } from "@/components/ftmo/FTMOWorkspace";
import { ftmoRequest, ftmoSnapshotSchema, startSchema, type FTMOSnapshot } from "@/lib/ftmo-api";

export default function FTMO20K() {
  const [data, setData] = useState<FTMOSnapshot | null>(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const actionPending = useRef(false), revision = useRef(0);
  const [costs, setCosts] = useState<FTMOCosts>({ swapLongUSD: "", swapShortUSD: "", swapHourUTC: "", commissionUSD: "3", slippageUSD: "0.05" });
  const { pathname } = useLocation();
  useEffect(() => {
    let active = true; let current: AbortController | null = null;
    const refresh = async () => {
      if (current || actionPending.current) return;
      const requestedRevision = revision.current;
      const controller = new AbortController(); current = controller;
      const timer = window.setTimeout(() => controller.abort(), 25000);
      try { const value = await ftmoRequest("state", ftmoSnapshotSchema, "GET", undefined, controller.signal); if (active && requestedRevision === revision.current) { setData(value); setError(""); } }
      catch (e) { if (active && requestedRevision === revision.current) { setData(null); setError(e instanceof Error ? e.message : "Lecture FTMO impossible."); } }
      finally { window.clearTimeout(timer); current = null; }
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), 3000);
    return () => { active = false; current?.abort(); window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!data) return;
    const s = data.state;
    if (s.swapLongUSD !== null) setCosts({ swapLongUSD: String(s.swapLongUSD), swapShortUSD: String(s.swapShortUSD), swapHourUTC: String(s.swapHourUTC), commissionUSD: String(s.commissionUSD), slippageUSD: String(s.slippageUSD) });
  }, [data?.state.swapLongUSD, data?.state.swapShortUSD, data?.state.swapHourUTC, data?.state.commissionUSD, data?.state.slippageUSD]);
  const action: FTMOWorkspace["action"] = async (path) => {
    if (actionPending.current) return;
    actionPending.current = true; revision.current += 1;
    setBusy(true); setActionError("");
    try {
      if (path === "verify") { await ftmoRequest(path, z.object({ started: z.literal(true) }), "POST"); }
      else {
        let body: unknown;
        if (path === "start") {
          if (Object.values(costs).some(value => !value.trim())) throw new Error("Renseignez les swaps signés USD/lot/nuit et l’heure de rollover UTC. Aucun swap nul ne sera supposé automatiquement.");
          body = startSchema.parse(Object.fromEntries(Object.entries(costs).map(([key, value]) => [key, Number(value)])));
        }
        if (path === "reset" && !window.confirm("Archiver ce challenge local et créer un nouveau compte virtuel de 20 000 € ? Aucun historique n’est supprimé.")) return;
        const value = await ftmoRequest(path, ftmoSnapshotSchema, path === "feed" ? "GET" : "POST", body);
        setData(value);
        if (path === "feed" && value.feed) console.info("[FTMO MT5] Flux reçu", { symbol: value.feed.symbol, server: value.feed.server, accountType: value.feed.accountType, bid: value.feed.bid, ask: value.feed.ask, tickTime: value.feed.time, fxSymbol: value.feed.fxSymbol, bars: value.feed.bars, mode: value.state.mode, liveEnabled: value.state.liveEnabled, running: value.state.running });
      }
    } catch (e) {
      if (path === "feed") setData(previous => previous ? { ...previous, connected: false, feed: null } : null);
      setActionError(`${path === "feed" ? "Test du flux FTMO non validé : " : ""}${e instanceof z.ZodError ? "Coûts invalides : swaps signés, heure UTC entière de 0 à 23, commission et slippage non négatifs." : e instanceof Error ? e.message : "Action FTMO impossible."}`);
    }
    finally { revision.current += 1; actionPending.current = false; setBusy(false); }
  };
  const title = pathname === "/mt5" ? "Connexion MT5" : pathname === "/historique" ? "Historique et performances" : pathname === "/settings" ? "Paramètres" : "Essai PAPER et challenge FTMO";
  return <div className="min-h-screen bg-background text-foreground lg:flex">
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-card/50 lg:flex">
      <div className="flex items-center gap-3 border-b border-border p-5"><span className="rounded-2xl bg-primary/15 p-3 text-primary"><Bot className="h-6 w-6" /></span><div><p className="text-lg font-bold">TradeBot IA</p><p className="text-xs text-muted-foreground">GOLD M15 · FTMO 20K</p></div></div>
      <nav className="flex-1 overflow-y-auto px-3 py-5" aria-label="Navigation principale"><AppNavigation /></nav>
      <div className="m-4 space-y-2 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-xs"><p className="font-semibold text-primary">PAPER exclusivement</p><p className="leading-relaxed text-muted-foreground">LIVE désactivé. Aucun ordre broker. Le capital FTMO virtuel est indépendant du solde MT5.</p></div>
    </aside>
    <div className="min-w-0 flex-1">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/50 px-4 py-4 sm:px-6"><h1 className="text-lg font-bold sm:text-xl">{title}</h1><span className="flex items-center gap-2 rounded-full bg-primary/10 px-3 py-2 text-xs font-semibold text-primary"><ShieldCheck className="h-4 w-4" />PAPER · LIVE désactivé</span></header>
      <main className="mx-auto max-w-[1400px] space-y-6 p-4 pb-28 sm:p-6 lg:pb-8">
        {error && <p role="alert" className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">Challenge FTMO : {error} Le registre de l’essai est indépendant.</p>}
        {actionError && <p role="alert" className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">{actionError}</p>}
        {data?.state.error && <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">Challenge FTMO : {data.state.error}</p>}
        {data && <section aria-label="Sécurité du worker du challenge FTMO" className="space-y-2 rounded-2xl border border-border bg-card p-4 text-sm">
          <p className="font-semibold">Worker du challenge : {data.worker.status} · {data.worker.alive ? "thread présent" : "thread arrêté"}</p>
          <p>Dernier heartbeat : {data.worker.heartbeat ? new Date(data.worker.heartbeat * 1000).toLocaleString("fr-FR") : "non observé"}. {data.worker.heartbeat && Date.now() / 1000 - data.worker.heartbeat > 15 ? "Attention : heartbeat ancien, suivi non confirmé." : ""}</p>
          {data.storageFault && <p role="alert" className="font-semibold text-destructive">Stockage verrouillé après panne : {data.storageFault}. Affichage du dernier état confirmé en mémoire ; contenu disque à vérifier avant toute reprise.</p>}
          {data.positionSafety === "HELD_UNPRICED" && <p role="alert">Position PAPER conservée sans nouvelle valorisation ni clôture. Les montants affichés sont ceux de la dernière observation confirmée, pas une cotation actuelle. Reprise explicite et convention UTC vérifiée requises.</p>}
          <p>Preuve UTC du challenge FTMO uniquement : {data.feed ? `${Date.now() / 1000 <= data.feed.utcValidUntil ? "expiration prévue" : "EXPIRÉE"} le ${new Date(data.feed.utcValidUntil * 1000).toLocaleString("fr-FR")}` : "non disponible ; aucune validité supposée"}. L’essai contrôle séparément ses cotations UTC directes.</p>
        </section>}
        {data && !data.state.verifiedContinuous && <p role="alert" className="text-sm text-muted-foreground">Le suivi a été interrompu. Des excursions d’equity entre mesures sont inconnues : ce résultat ne prouve pas le respect continu des limites.</p>}
        <Outlet context={{ data, busy, costs, setCosts, action } satisfies FTMOWorkspace} />
        <footer className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">GOLD M15 2,5R conservé · 5R réservé à la comparaison historique · aucun basculement automatique.<br />Le démarrage du challenge FTMO reste suspendu. L’essai PAPER utilise son propre compte virtuel, sans certification FTMO. Aucun ancien backtest à relancer.</footer>
      </main>
      <nav aria-label="Navigation mobile" className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card p-2 lg:hidden"><AppNavigation mobile /></nav>
    </div>
  </div>;
}
