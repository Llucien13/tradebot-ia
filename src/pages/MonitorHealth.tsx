import { Activity } from "lucide-react";
import { date, number, Panel } from "@/components/monitor/MonitorCards";
import { statusLabels, useMonitor } from "@/components/monitor/MonitorLayout";
import MonitorEvents from "@/components/monitor/MonitorEvents";
import MonitorNotifications from "@/components/monitor/MonitorNotifications";

export default function MonitorHealth() {
  const { data, connected, fresh, now } = useMonitor();
  const health = data?.health;
  const hb = health?.worker.heartbeat;
  const hbFresh = connected && hb != null && now-hb >= 0 && now-hb <= 15;
  const fields = [
    ["Bridge Python", connected ? "Actif · observation récente" : "Inaccessible ou observation non confirmée"],
    ["Connexion MT5", connected && health?.mt5 === "DISCONNECTED" ? "Déconnecté · erreur explicite du connecteur V85" : connected && health?.mt5 === "CONNECTED" && fresh ? "Confirmée par les dernières cotations" : "Inconnue · aucune connexion supposée"],
    ["Moteur PAPER", !connected ? `Inconnu${data ? ` · dernier état : ${statusLabels[data.status]}` : ""}` : data ? statusLabels[data.status] : "Inconnu"],
    ["Worker PAPER", connected && health?.worker.alive ? "Thread présent (pas une preuve de suivi continu)" : "Présence non confirmée"],
    ["Heartbeat", `${date(hb)} · ${hbFresh ? "récent" : "ancien / inconnu"}`],
    ["Dernière observation du moteur", date(health?.lastObserved)],
    ["Dernière vérification de signal enregistrée", health?.lastSignal ? `${date(health.lastSignal.time)} · sens retourné ${health.lastSignal.side}` : "Non enregistrée / inconnue"],
    ["Séries M15", health?.m15 === "INSUFFICIENT" ? "Insuffisantes · refus explicite V85" : health?.m15 === "LAST_VALIDATED" ? `${health.frameCounts.m15} bougies lors du dernier contrôle réussi ; état actuel non retesté par V86` : "Préparation inconnue · aucune validation supposée"],
    ["Suivi continu", health?.continuous ? "Aucune interruption signalée dans le registre" : "Non certifié / interrompu"],
    ["Dernière erreur observée", data?.lastError ? `${date(data.lastError.time)} · ${data.lastError.message}` : "Aucune erreur enregistrée par V86"],
  ];
  return <div className="space-y-6"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Observer, pas intervenir</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Santé du bot</h1><p className="mt-3 text-sm leading-relaxed text-slate-400">L’attente normale, la disponibilité de la passerelle et les arrêts de sécurité sont affichés séparément.</p></div>
    <Panel title="État de surveillance" aside={<Activity size={18} className="text-cyan-300" />}><dl className="grid gap-5 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-slate-400">{label}</dt><dd className={`mt-2 break-words text-sm leading-relaxed ${label === "Dernière erreur observée" && data?.lastError ? "text-amber-200" : "text-slate-200"}`}>{value}</dd></div>)}</dl>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">{["XAUUSD", "EURUSD"].map(symbol => {
        const tick = health?.ticks[symbol];
        const age = tick?.time == null ? null : now-tick.time;
        const tickFresh = connected && age != null && age >= 0 && age <= 15;
        const waiting = health?.waitingReason?.startsWith(symbol) ? health.waitingAge : null;
        return <div key={symbol} className="rounded-xl border border-slate-700 bg-slate-950/50 p-4"><p className="text-sm font-medium">{symbol}</p><p className={`mt-2 text-sm tabular-nums ${tickFresh ? "text-emerald-300" : "text-amber-200"}`}>{tickFresh ? "Tick frais" : "Tick non certifiable"} · {age == null ? "âge inconnu" : `${number(age, " s")} depuis le dernier tick connu`}</p><p className="mt-2 text-xs text-slate-400">{date(tick?.time)} Europe/Paris</p>{waiting != null && <p className="mt-2 text-xs text-amber-200">Âge au refus V85 : {number(waiting, " s")}</p>}</div>;
      })}</div>
      {health?.waitingReason && <p className="mt-5 break-words text-sm text-amber-200">Attente : {health.waitingReason}</p>}
      <p className="mt-5 text-xs leading-relaxed text-slate-400">V86 ne relance aucune lecture MT5 et ne reteste pas les séries. Les données futures, la limite de 15 secondes, les conversions configurées et SAFE_STOP restent sous le contrôle exclusif de V85.</p>
    </Panel>
    <MonitorEvents /><MonitorNotifications />
    <Panel title="Votre iPhone, en toute sécurité"><div className="space-y-3 text-sm leading-relaxed text-slate-300"><p><strong className="text-slate-100">Disponible maintenant :</strong> interface adaptée à Safari, navigation tactile et lecture depuis l’aperçu local du PC. Sur iPhone, continuez à utiliser <strong>Bureau à distance Google</strong> pour consulter ce PC.</p><p><strong className="text-slate-100">Pas d’accès direct sur le Wi-Fi :</strong> le bridge écoute uniquement sur 127.0.0.1:8765. Cette adresse sur un iPhone désignerait l’iPhone, pas l’Acer. Le port n’est pas exposé au réseau local ni à Internet.</p><p><strong className="text-slate-100">Architecture distante préparée, non activée :</strong> il faudrait une passerelle HTTPS authentifiée avec MFA, autorisant seulement les lectures du monitoring, sans proxy vers les commandes V85. Sa configuration et votre approbation explicite restent nécessaires. Aucune route d’exécution ne doit être exposée.</p><p><strong className="text-slate-100">Écran d’accueil :</strong> Safari → Partager → Sur l’écran d’accueil pour un site accessible. Cela ne crée ni connexion sécurisée au PC ni accès hors domicile. Aucun cache hors ligne de données financières n’est installé.</p></div></Panel>
  </div>;
}
