import { CalendarClock, LockKeyhole, ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Panel, date } from "./MonitorCards";
import { useMonitor } from "./MonitorLayout";

const labels = {
  UNKNOWN: "Horaires inconnus · entrées bloquées", OPEN: "Hors fenêtre anti-gap",
  ENTRY_BLOCKED: "Entrées PAPER bloquées", EXIT_DUE: "Échéance de sortie PAPER",
  CLOSE_PENDING: "Clôture impossible · position conservée", MARKET_CLOSED: "Fermeture atteinte",
  CLOSED: "Sortie PAPER enregistrée",
};

export default function WeeklyGapProtection() {
  const { data, connected, now } = useMonitor();
  const gap = data?.antiGap;
  const heartbeat = data?.health.worker.heartbeat;
  const confirmed = !!gap && connected && !!data?.health.worker.alive && heartbeat != null
    && now-heartbeat >= 0 && now-heartbeat <= 15 && now-gap.checkedAt >= 0 && now-gap.checkedAt <= 15
    && (gap.expiresAt == null || now < gap.expiresAt);
  const running = confirmed && data?.status === "RUNNING";
  const warning = !running || !gap || ["UNKNOWN", "CLOSE_PENDING", "EXIT_DUE", "MARKET_CLOSED"].includes(gap.status);
  const reference = gap ? confirmed ? now : gap.checkedAt : now;
  const remaining = gap?.weeklyClose == null ? null : Math.max(0, Math.ceil(gap.weeklyClose-reference));
  const countdown = remaining == null ? "Indisponible" : `${Math.floor(remaining/3600).toString().padStart(2, "0")} : ${Math.floor(remaining%3600/60).toString().padStart(2, "0")} : ${(remaining%60).toString().padStart(2, "0")}`;
  const Icon = warning ? ShieldAlert : ShieldCheck;

  return <Panel title="Protection anti-gap · GOLD PAPER" aside={<Badge variant="outline" className={`max-w-full whitespace-normal rounded-full px-3 py-1.5 text-xs ${warning ? "border-amber-400/40 bg-amber-400/10 text-amber-100" : "border-cyan-400/30 bg-cyan-400/10 text-cyan-200"}`}><Icon size={14} className="mr-2 shrink-0" />{!confirmed ? "Protection non confirmée" : !running ? "Moteur arrêté ou en attente" : gap ? labels[gap.status] : "État inconnu"}</Badge>}>
    <div className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
      <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
        <p className="flex items-center gap-2 text-xs text-slate-300"><CalendarClock size={16} className="text-cyan-300" />{confirmed ? "Avant fermeture attestée" : "Dernier compte à rebours connu · figé"}</p>
        <p className="mt-4 break-words font-mono text-2xl font-semibold tabular-nums tracking-tight text-slate-100 sm:text-3xl">{countdown}</p>
        <p className="mt-3 text-xs leading-relaxed text-slate-400">{remaining === 0 ? "Fermeture atteinte, pas de prix de sortie reconstitué." : "Heures : minutes : secondes · aucune heure du vendredi supposée."}</p>
        {gap?.weeklyClose != null && <div className="mt-4 space-y-1 border-t border-slate-700 pt-3 text-xs leading-relaxed text-slate-300"><p>{date(gap.weeklyClose)} · Europe/Paris</p><p>{date(gap.weeklyClose, "UTC")} · UTC</p></div>}
      </div>
      <div className="min-w-0 space-y-4">
        <p role={warning ? "alert" : "status"} className={`break-words text-sm leading-relaxed ${warning ? "text-amber-100" : "text-slate-200"}`}>{gap?.reason || "Aucun contrôle anti-gap reçu. Ne pas considérer la protection comme active sans une passerelle compatible et ses tests."}</p>
        {gap && <p className="text-xs leading-relaxed text-slate-400">Dernier statut moteur : {labels[gap.status]}. Contrôle : {date(gap.checkedAt)} · Europe/Paris.{!running && " Aucune exécution automatique ne peut être certifiée dans cet état."}</p>}
        <ol className="grid gap-3 min-[420px]:grid-cols-2">
          <li className="rounded-xl border border-slate-700 p-3"><p className="text-sm font-semibold text-cyan-200">T − 60 minutes</p><p className="mt-1 text-xs leading-relaxed text-slate-300">Aucune nouvelle position du bot.</p></li>
          <li className="rounded-xl border border-slate-700 p-3"><p className="text-sm font-semibold text-cyan-200">T − 15 minutes</p><p className="mt-1 text-xs leading-relaxed text-slate-300">Tentative de sortie simulée, ticks XAUUSD et EURUSD ≤ 15 s, coûts appliqués.</p></li>
        </ol>
        {gap?.sourceURL && <p className="break-words text-xs leading-relaxed text-slate-400">Attestation locale avec empreinte du document · UTC/DST et exceptions à vérifier auprès de la <a href={gap.sourceURL} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline underline-offset-4">source officielle FTMO</a>. Expiration : {date(gap.expiresAt, "UTC")} UTC. L’empreinte garantit l’intégrité locale, pas l’authenticité du contenu.</p>}
      </div>
    </div>
    <p className="mt-5 flex items-start gap-2 border-t border-slate-800 pt-4 text-xs leading-relaxed text-slate-400"><LockKeyhole size={14} className="mt-0.5 shrink-0 text-cyan-300" />PAPER uniquement · LIVE OFF. Le moteur contrôle ces échéances à chaque cycle, sans attendre un signal M15. Un arrêt, un SAFE_STOP, une cotation invalide ou un calendrier incertain peut empêcher une clôture : la position reste conservée et une alerte est journalisée. Les positions manuelles MT5 ne sont jamais modifiées.</p>
  </Panel>;
}
