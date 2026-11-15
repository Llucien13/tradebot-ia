import { date, Panel } from "./MonitorCards";
import { useMonitor } from "./MonitorLayout";

export default function MonitorEvents({ tradesOnly = false }: { tradesOnly?: boolean }) {
  const { data } = useMonitor();
  const events = (data?.events ?? []).filter(e => tradesOnly ? e.trade_id != null : e.trade_id == null).slice(0, 30);
  return <Panel title={tradesOnly ? "Événements observés des trades" : "Événements techniques récents"}>
    {!events.length ? <p className="text-sm text-slate-400">Aucun événement disponible dans les dernières observations.</p> : <ol className="max-h-[28rem] space-y-4 overflow-y-auto">{events.map(event => <li key={event.id} className="border-l-2 border-slate-700 pl-4"><p className="text-[11px] text-slate-400">{date(event.at)} Europe/Paris · {date(event.at, "UTC")} UTC</p><p className="mt-1 break-words text-sm leading-relaxed">{event.message}</p><p className="mt-1 text-[11px] text-slate-400">Observé le {date(event.observed)}{event.delivery ? ` · Telegram ${event.delivery}` : ""}</p></li>)}</ol>}
    <p className="mt-4 text-xs leading-relaxed text-slate-400">Ouvertures et clôtures proviennent du registre, même si elles précèdent l’installation V86. Les mises à jour sont les changements effectivement observés ; une transition entre deux relevés peut ne pas être connue. L’heure d’observation n’est pas une heure d’exécution.</p>
  </Panel>;
}
