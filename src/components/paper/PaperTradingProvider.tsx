import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { z } from "zod";
import { type Strategy } from "@/lib/strategies";
import { accountInputSchema, accountSchema, emptyPaperState, feedSchema, readPaperState, readTrendMaster, writePaperState, PAPER_KEY, type PaperAccountInput, type PaperState } from "@/lib/paper/model";
import { advancePaper, paperUnrealized } from "@/lib/paper/engine";
import { calculateStatistics } from "@/lib/backtest/statistics";

interface PaperContextValue {
  state: PaperState; strategy: Strategy | null; error: string; strategyError: string; refreshing: boolean;
  refresh: () => Promise<void>; configure: (account: PaperAccountInput) => Promise<void>; setRunning: (running: boolean) => Promise<void>;
  unrealized: number | null; equity: number | null; statistics: ReturnType<typeof calculateStatistics> | null;
}
const PaperContext = createContext<PaperContextValue | null>(null);
async function locked<T>(action: () => T | Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error("Ce navigateur ne permet pas le verrouillage du registre entre onglets. Paper trading bloqué pour éviter des doubles exécutions.");
  return navigator.locks.request("tradebot-paper-real-v1", { mode: "exclusive" }, action);
}
function initialState() { try { return { state: readPaperState(), error: "" }; } catch { return { state: emptyPaperState(), error: "Registre paper inaccessible ou incohérent. Aucun ancien mock n’est importé, aucun compte n’est recréé automatiquement." }; } }
export function PaperTradingProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(initialState);
  const [state, setState] = useState({ ...initial.state, running: false });
  const [startupReady, setStartupReady] = useState(false);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [error, setError] = useState(initial.error);
  const [strategyError, setStrategyError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const location = useLocation();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; const active = request.current; request.current = null; active?.abort(); }; }, []);
  useEffect(() => {
    let active = true;
    void locked(() => {
      const stored = readPaperState();
      // Startup changes only the run flag, never strategies, positions or audit history.
      if (stored.running) { stored.running = false; writePaperState(stored); }
      return stored;
    }).then(stored => {
      if (active) { setState(stored); setStartupReady(true); }
    }).catch(e => {
      if (active) setError(e instanceof Error ? e.message : "Arrêt de sécurité au démarrage impossible. Simulation bloquée.");
    });
    return () => { active = false; };
  }, []);
  const publish = (next: PaperState) => { writePaperState(next); if (mounted.current) setState(next); };
  const refresh = useCallback(async () => {
    if (!startupReady || request.current) return;
    let selected: Strategy | null = null;
    let selectedError = "";
    try { selected = readTrendMaster(); if (!selected.enabled) selectedError = "Trend Master XAU est enregistrée mais désactivée. Aucune nouvelle entrée autorisée."; }
    catch (e) { selectedError = e instanceof Error ? e.message : "Stratégie enregistrée invalide."; }
    setStrategy(selected); setStrategyError(selectedError);
    let stored: PaperState;
    try { stored = readPaperState(); }
    catch { setError("Registre paper invalide ou inaccessible. Simulation bloquée, aucun remplacement du journal."); return; }
    if (mounted.current) setState(stored);
    if (!selected?.enabled && !stored.position) {
      if (stored.pending) try { await locked(() => { const next = readPaperState(); const signal = next.signals.find(s => s.id === next.pending?.signalId); if (signal) signal.execution = "Entrée annulée : stratégie désactivée ou indisponible."; next.pending = null; publish(next); }); } catch (e) { setError(e instanceof Error ? e.message : "Stockage paper indisponible."); }
      return;
    }
    if (!navigator.onLine) { setError("Navigateur hors ligne. Aucun signal ni trade de remplacement ; le dernier registre réel est conservé."); return; }
    const controller = new AbortController(); request.current = controller; setRefreshing(true);
    const timeout = window.setTimeout(() => controller.abort("timeout"), 25000);
    try {
      const response = await fetch("/api/paper-market", { signal: controller.signal, cache: "no-store" });
      const raw: unknown = await response.json();
      if (!response.ok) {
        const failure = z.object({ statusMessage: z.string().optional(), message: z.string().optional() }).safeParse(raw);
        throw new Error(failure.success ? failure.data.statusMessage || failure.data.message || "Flux Twelve Data indisponible." : "Flux Twelve Data indisponible.");
      }
      const feed = feedSchema.parse(raw);
      if (controller.signal.aborted) return;
      await locked(() => {
        if (controller.signal.aborted) return;
        // Read again after fetching: never execute a strategy that was edited mid-request.
        let current: Strategy | null = null;
        try { current = readTrendMaster(); } catch { /* Existing positions still use their frozen saved configuration. */ }
        const previous = readPaperState();
        const next = advancePaper(previous, current, feed);
        publish(next);
        console.info("[PaperTrading] Cycle réel validé", { source: feed.source, candles1h: feed.series["1h"].length, candles4h: feed.series["4h"].length, latest1h: new Date(feed.series["1h"][feed.series["1h"].length - 1].time).toISOString(), latest4h: new Date(feed.series["4h"][feed.series["4h"].length - 1].time).toISOString(), signalsStored: next.signals.length, newClosedTrades: next.trades.length - previous.trades.length, openPositions: next.position ? 1 : 0 });
        if (mounted.current) { setStrategy(current); setStrategyError(!current ? "Stratégie enregistrée indisponible : aucune nouvelle entrée." : current.enabled ? "" : "Trend Master XAU est désactivée : les sorties existantes restent gérées."); setError(""); }
      });
    } catch (e) {
      if (!mounted.current || (controller.signal.aborted && controller.signal.reason !== "timeout")) return;
      setError(controller.signal.reason === "timeout" ? "Délai Twelve Data dépassé. Moteur suspendu, aucun prix de remplacement." : e instanceof z.ZodError ? "Données Twelve Data ou registre invalides. Aucun signal ni trade généré." : e instanceof Error ? e.message : "Paper trading bloqué.");
    } finally { window.clearTimeout(timeout); if (request.current === controller) { request.current = null; if (mounted.current) setRefreshing(false); } }
  }, [startupReady]);
  const enabledPage = ["/", "/historique", "/settings", "/scalping", "/strategy-h1"].includes(location.pathname);
  useEffect(() => {
    if (!startupReady || (!enabledPage && !state.running && !state.position)) return;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 300000);
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus); window.addEventListener("online", focus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", focus); window.removeEventListener("online", focus); };
  }, [enabledPage, location.pathname, state.running, !!state.position, refresh, startupReady]);
  useEffect(() => {
    const storage = (event: StorageEvent) => { if (event.key === PAPER_KEY) { try { setState(readPaperState()); } catch { setError("Registre paper modifié ou invalide dans un autre onglet. Simulation bloquée."); } } };
    window.addEventListener("storage", storage); return () => window.removeEventListener("storage", storage);
  }, []);
  const configure = async (input: PaperAccountInput) => {
    try {
      accountInputSchema.parse(input);
      const existing = readPaperState();
      if (existing.position || existing.running) throw new Error("Mettez les entrées en pause et attendez la clôture de la position avant de modifier le compte.");
      if (existing.account && !window.confirm("Enregistrer ces paramètres démarrera une nouvelle simulation. Le registre actuel sera archivé localement, pas recalculé ni converti rétroactivement. Continuer ?")) return;
      const response = await fetch("/api/paper-fx", { cache: "no-store", signal: AbortSignal.timeout(20000) });
      const raw: unknown = await response.json();
      if (!response.ok) {
        const failure = z.object({ statusMessage: z.string().optional(), message: z.string().optional() }).safeParse(raw);
        throw new Error(failure.success ? failure.data.statusMessage || failure.data.message || "Conversion EUR/USD indisponible." : "Conversion EUR/USD indisponible.");
      }
      const fx = z.object({ source: z.literal("TWELVE_DATA"), usdPerEur: z.number().finite().positive(), time: z.number().int().positive() }).parse(raw);
      const account = accountSchema.parse({ ...input, currency: "EUR", usdPerEur: fx.usdPerEur, fxTime: fx.time, fxSource: fx.source, createdAt: Date.now() });
      await locked(() => {
        const previous = readPaperState();
        if (previous.position || previous.running) throw new Error("Le compte est devenu actif entre-temps. Modification annulée.");
        if (previous.account) localStorage.setItem(PAPER_KEY + ":archive:" + previous.account.createdAt + ":" + Date.now(), JSON.stringify(previous));
        const next = emptyPaperState(); next.account = account; next.cash = account.initialCapital;
        next.equity = [{ time: account.createdAt, equity: account.initialCapital, drawdown: 0 }]; publish(next);
      });
      setError(""); await refresh();
    } catch (e) { setError(e instanceof z.ZodError ? "Capital positif, spread positif, coûts non négatifs et volumes positifs requis ; levier simulé de 1 à 20." : e instanceof Error ? e.message : "Enregistrement EUR impossible."); }
  };
  const setRunning = async (running: boolean) => {
    try {
      if (!startupReady) throw new Error("Contrôle STOPPED au démarrage non terminé. Simulation bloquée.");
      await locked(() => {
        const next = readPaperState();
        if (!next.account) throw new Error("Initialisez explicitement le capital et les frais du compte paper.");
        if (running) { const s = readTrendMaster(); if (!s.enabled) throw new Error("La stratégie enregistrée est désactivée. Ses paramètres ne seront pas changés par le simulateur."); if (next.cash! <= 0) throw new Error("Capital paper épuisé."); }
        if (next.pending) { const signal = next.signals.find(s => s.id === next.pending!.signalId); if (signal) signal.execution = "Entrée annulée par le changement d’état du paper trading."; }
        next.pending = null; next.running = running; next.startedAt = running ? Date.now() : next.startedAt; publish(next);
      });
      setError(""); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Action paper impossible."); }
  };
  const unrealized = paperUnrealized(state);
  const equity = state.cash === null || unrealized === null ? null : state.cash + unrealized;
  const statistics = state.account ? calculateStatistics(state.account.initialCapital, state.cash!, state.trades, state.equity) : null;
  return <PaperContext.Provider value={{ state, strategy, error, strategyError, refreshing, refresh, configure, setRunning, unrealized, equity, statistics }}>{children}</PaperContext.Provider>;
}
export function usePaperTrading() { const value = useContext(PaperContext); if (!value) throw new Error("PaperTradingProvider absent."); return value; }
