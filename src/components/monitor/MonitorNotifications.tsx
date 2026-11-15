import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { saveNotifications, testNotification, type NotificationOptions } from "@/lib/paper-monitor-api";
import { useMonitor } from "./MonitorLayout";
import { Panel } from "./MonitorCards";

export default function MonitorNotifications() {
  const { data, connected } = useMonitor();
  const client = useQueryClient();
  const [message, setMessage] = useState("");
  const notifications = data?.notifications;
  const mutation = useMutation({ mutationFn: saveNotifications,
    onSuccess: async () => { setMessage("Options enregistrées sur le PC, indépendamment du moteur PAPER."); await client.invalidateQueries({ queryKey: ["paper-monitor-v86"] }); },
    onError: (error: Error) => setMessage(error.message),
  });
  const test = useMutation({ mutationFn: testNotification, onSuccess: () => { setMessage("Test placé en file. Consultez son état de livraison ci-dessous ; aucun trade n’a été déclenché."); void client.invalidateQueries({ queryKey: ["paper-monitor-v86"] }); }, onError: (error: Error) => setMessage(error.message) });
  const labels: [keyof NotificationOptions, string, string][] = [
    ["enabled", "Activer les notifications Telegram", "Désactivées par défaut. Aucun token n’est saisi dans le navigateur."],
    ["open", "Ouverture PAPER enregistrée", "Instrument, entrée, volume, SL/TP et risque réellement connus."],
    ["close", "Clôture PAPER confirmée", "Résultat et motif enregistré, y compris WEEKLY_CLOSE pour une sortie anti-gap simulée."],
    ["safe", "SAFE_STOP et protection anti-gap", "Horaires inconnus, blocage à 60 min, échéance à 15 min ou clôture impossible. Une alerte anti-gap ne signifie pas forcément SAFE_STOP."],
    ["recovery", "Reprise après une attente prolongée", "Optionnel, après au moins 60 secondes d’attente observée."],
  ];
  return <Panel title="Notifications iPhone · Telegram" aside={<Bell size={18} className="text-cyan-300" />}>
    <p className="mb-5 text-sm leading-relaxed text-slate-400">{notifications?.configured ? "Variables serveur détectées. Leur présence ne prouve pas la réception : effectuez un test." : "Telegram non configuré. Toutes les fonctions PAPER restent disponibles sans lui."}</p>
    <div className="divide-y divide-slate-800">{labels.map(([key, label, hint]) => <div key={key} className="flex items-center justify-between gap-4 py-4"><label htmlFor={`notify-${key}`} className="min-w-0 cursor-pointer"><span className="block text-sm font-medium">{label}</span><span className="mt-1 block text-xs leading-relaxed text-slate-400">{hint}</span></label><Switch id={`notify-${key}`} checked={notifications?.settings[key] ?? false} disabled={!connected || mutation.isPending || !notifications || (key !== "enabled" && !notifications.settings.enabled)} onCheckedChange={checked => { if (notifications) mutation.mutate({ ...notifications.settings, [key]: checked }); }} className="shrink-0 data-[state=checked]:bg-cyan-500 data-[state=unchecked]:bg-slate-600" /></div>)}</div>
    <Button variant="outline" className="mt-4 min-h-11 rounded-xl border-slate-700 bg-transparent" disabled={!connected || !notifications?.configured || !notifications.settings.enabled || test.isPending} onClick={() => test.mutate()}><Send size={15} className="mr-2" />{test.isPending ? "Mise en file…" : "Tester un message · aucun trade"}</Button>
    {message && <p role="status" className="mt-4 break-words text-sm text-cyan-200">{message}</p>}
    <div className="mt-5 space-y-2 rounded-xl bg-slate-800/50 p-4 text-xs leading-relaxed text-slate-300"><p>Livraisons : {notifications?.deliveries.length ? notifications.deliveries.map(d => `${d.status} : ${d.count}`).join(" · ") : "aucun envoi enregistré"}</p>{notifications?.lastFailure && <p role="alert" className="text-amber-200">Dernier échec : {notifications.lastFailure}</p>}<p>Un envoi dont la réception est incertaine n’est pas renvoyé automatiquement, pour éviter un doublon. Les limitations Telegram sont réessayées jusqu’à 5 fois avec temporisation.</p><p>Si le PC ou le bridge est éteint, il ne peut pas signaler sa propre panne. Aucun surveillant externe n’est installé. La perte de connexion n’est notifiée qu’à travers un SAFE_STOP réellement observé.</p></div>
    <details className="mt-5 rounded-xl border border-slate-700 p-4 text-sm"><summary className="min-h-8 cursor-pointer font-medium">Configurer Telegram sans service payant</summary><ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-slate-300"><li>Dans Telegram, ouvrez le compte officiel vérifié <strong>@BotFather</strong>, créez votre bot avec sa commande <code>/newbot</code> et conservez le token privé.</li><li>Ouvrez la conversation avec votre nouveau bot et envoyez <code>/start</code>. Récupérez votre chat ID avec l’API officielle <code>getUpdates</code> dans un outil local de confiance ; ne partagez pas l’URL contenant le token et ne la collez pas dans Dyad.</li><li>Dans Windows, ouvrez « Modifier les variables d’environnement pour votre compte ». Ajoutez <code className="break-all">TRADEBOT_TELEGRAM_TOKEN</code> et <code className="break-all">TRADEBOT_TELEGRAM_CHAT_ID</code>. Ne les écrivez dans aucun fichier du dépôt.</li><li>Fermez puis relancez une seule fois la passerelle depuis l’Explorateur. Activez Telegram ici et cliquez sur « Tester un message ». Vérifiez la réception « PAPER — VIRTUEL » sur votre iPhone.</li><li>Autorisez les notifications Telegram dans les réglages iOS. Si le token a été partagé par erreur, révoquez-le auprès de BotFather.</li></ol></details>
  </Panel>;
}
