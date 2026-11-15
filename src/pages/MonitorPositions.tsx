import PaperPerformanceSummary from "@/components/monitor/PaperPerformanceSummary";
import { PositionCard } from "@/components/monitor/MonitorCards";
import ManualPositionsPanel from "@/components/monitor/ManualPositionsPanel";
import WeeklyGapProtection from "@/components/monitor/WeeklyGapProtection";

export default function MonitorPositions() {
  return <div className="space-y-7">
    <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">V87 · trading manuel MT5 et simulation simultanés</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Premium Control Desk</h1><p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-400">Deux sources séparées : le registre fictif du bot et les positions du compte MT5. Aucune opération MT5 n’est exécutée depuis ce tableau de bord.</p></div>
    <WeeklyGapProtection />
      <PaperPerformanceSummary />
    <section aria-labelledby="bot-positions" className="space-y-4"><div><h2 id="bot-positions" className="text-lg font-semibold">Positions du bot</h2><p className="mt-2 text-sm leading-relaxed text-slate-400">PAPER · capital fictif de 20 000 € · une position maximum pour le bot uniquement. Aucun ticket broker ni magic number MT5 n’est créé par une simulation. Les trades manuels ne sont ni comptés dans cette limite ni intégrés aux performances PAPER.</p></div><PositionCard /></section>
    <ManualPositionsPanel />
  </div>;
}
