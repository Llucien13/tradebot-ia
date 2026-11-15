import { useEffect, useState } from "react";
import { Metric, Panel, money, tone } from "./MonitorCards";

type PaperTrade = { pnl?: number | null };
type PaperState = {
  balance?: number;
  equity?: number;
  trades?: PaperTrade[];
};

const INITIAL = 20000;

export default function PaperPerformanceSummary() {
  const [state, setState] = useState<PaperState | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;

    async function refresh() {
      try {
        const response = await fetch(
          "http://127.0.0.1:8765/paper-trial/state",
          { cache: "no-store" }
        );
        if (!response.ok) throw new Error("API indisponible");
        const body = await response.json();
        if (!body.state || typeof body.state.balance !== "number") {
          throw new Error("Etat PAPER indisponible");
        }
        if (active) {
          setState(body.state);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      }
    }

    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const trades = (state?.trades ?? []).filter(
    (t) => typeof t.pnl === "number" && Number.isFinite(t.pnl)
  );
  const pnl = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const wins = trades.filter((t) => (t.pnl ?? 0) > 0).length;
  const equity = state?.equity;
  const performance = typeof equity === "number"
    ? ((equity - INITIAL) / INITIAL) * 100
    : null;

  return (
    <Panel
      title="Performances du compte PAPER"
      aside={<span className="text-xs text-slate-400">Simulation uniquement</span>}
    >
      {error && <p className="mb-3 text-sm text-amber-300">Connexion aux statistiques indisponible.</p>}
      {!state ? (
        <p className="text-sm text-slate-400">En attente du registre PAPER.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Metric label="Solde PAPER" value={money(state.balance)} />
          <Metric label="Equite" value={money(equity)} />
          <Metric label="P&L cloture" value={money(pnl)} color={tone(pnl)} />
          <Metric label="Rendement de l'equite" value={performance === null ? "—" : performance.toFixed(2) + " %"} color={tone(performance)} />
          <Metric label="Trades clotures" value={String(trades.length)} />
          <Metric label="Taux de reussite" value={trades.length ? (wins * 100 / trades.length).toFixed(1) + " %" : "—"} />
        </div>
      )}
      <p className="mt-3 text-xs text-slate-400">
        Capital initial fictif : 20 000 EUR. Actualisation toutes les 10 secondes.
        Les valeurs d'equite peuvent etre anciennes si le moteur est arrete.
      </p>
    </Panel>
  );
}