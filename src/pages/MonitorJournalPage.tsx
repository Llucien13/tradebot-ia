import MonitorJournal from "@/components/monitor/MonitorJournal";
import MonitorEvents from "@/components/monitor/MonitorEvents";

export default function MonitorJournalPage() {
  return <div className="space-y-6"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Traçabilité du registre</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Journal des trades</h1><p className="mt-3 text-sm leading-relaxed text-slate-400">Ouvertures et clôtures persistantes, identifiants stables et événements réellement observés. Une coupure ne crée aucune clôture.</p></div><MonitorJournal /><MonitorEvents tradesOnly /></div>;
}
