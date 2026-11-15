import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { RefreshCw, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readManualPositions } from "@/lib/paper-monitor-api";
import type { BrokerPosition } from "@/lib/manual-positions";
import { date, number, Panel, tone } from "./MonitorCards";
import { useMonitor } from "./MonitorLayout";

const statusText = {
  BUSY: "Lecture différée : le bridge est occupé. Aucun changement d’état du bot PAPER.",
  DISCONNECTED: "MT5 est déconnecté ou son API n’est pas initialisée. Utilisez la connexion MT5 existante sur le PC ; aucune reconnexion automatique n’est imposée au bot.",
  UNAVAILABLE: "Positions MT5 non vérifiables. Cela ne signifie pas que le compte est sans position.",
  ACCOUNT_CHANGED: "Compte ou mode MT5 changé pendant la lecture. Relevé rejeté ; vérifiez le compte connecté.",
  TOO_MANY_POSITIONS: "Plus de 1 000 positions : relevé refusé plutôt qu’un affichage incomplet.",
  OBSERVED: "Dernier relevé MT5 reçu.",
};
const origins = { MANUAL: "Origine manuelle indiquée par MT5", EXTERNAL_AUTOMATION: "Expert externe · pas le bot PAPER", UNCONFIRMED: "Provenance à confirmer", NETTING_AGGREGATE: "Position MT5 agrégée · attribution incertaine" };
function accountMoney(value: number | null, currency: string) {
  return value == null ? "—" : `${number(value)} ${currency}`;
}
function BrokerCard({ position: p, currency, recent }: { position: BrokerPosition; currency: string; recent: boolean }) {
  return <article className="min-w-0 rounded-xl border border-slate-700 bg-slate-950/50 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-semibold">{p.symbol || "Instrument non renseigné"} <span className={p.side === "BUY" ? "text-emerald-300" : p.side === "SELL" ? "text-rose-300" : "text-slate-300"}>{p.side === "BUY" ? "ACHAT" : p.side === "SELL" ? "VENTE" : "Sens inconnu"}</span></h3><p className="mt-2 text-xs text-slate-400">{origins[p.provenance]}</p></div><div className="text-right"><p className="text-xs text-slate-400">Profit MT5 au relevé · pas un résultat PAPER</p><p className={`mt-1 text-lg font-semibold tabular-nums ${recent ? tone(p.profit) : "text-slate-400"}`}>{accountMoney(p.profit, currency)}</p><p className="mt-1 text-[11px] text-amber-200">{recent ? "Fraîcheur de cotation non certifiée" : "Relevé ancien / non confirmé"}</p></div></div>
    <dl className="mt-4 grid grid-cols-2 gap-4 text-xs sm:grid-cols-3">{[
      ["Ticket MT5", p.ticket], ["Identifiant de position", p.identifier ?? "Non fourni"], ["Magic number", p.magic ?? "Non fourni"],
      ["Volume", number(p.volume, " lots")], ["Prix d’entrée MT5", number(p.entry)], ["Dernier prix MT5 connu", number(p.lastPrice)],
      ["SL défini dans MT5", p.sl === 0 ? "Non défini" : number(p.sl)], ["TP défini dans MT5", p.tp === 0 ? "Non défini" : number(p.tp)], ["Swap MT5 séparé", accountMoney(p.swap, currency)],
    ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-slate-400">{label}</dt><dd className="mt-1 break-all tabular-nums text-slate-100">{value}</dd></div>)}</dl>
    <details className="mt-4 text-xs text-slate-400"><summary className="min-h-8 cursor-pointer">Identification et horodatages bruts</summary><p className="mt-2 break-all font-mono">{p.id}</p><p className="mt-2 break-words">Reason MT5 : {p.reason ?? "non fourni"} · time : {p.timeRaw ?? "non fourni"} · time_msc : {p.timeMscRaw ?? "non fourni"}.</p><p className="mt-2 leading-relaxed">Horodatages conservés bruts : aucune conversion de fuseau déduite pour cette API. Le profit MT5 ne constitue pas un P&L clôturé et n’inclut pas nécessairement tous les coûts.</p></details>
  </article>;
}

export default function ManualPositionsPanel() {
  const { now } = useMonitor();
  const query = useQuery({ queryKey: ["mt5-manual-positions-v87"], queryFn: ({ signal }) => readManualPositions(signal),
    refetchInterval: 10000, refetchIntervalInBackground: false, retry: false });
  const data = query.data;
  const account = data?.account;
  const recent = !query.isError && !!data?.available && data.observedAt != null && now-data.observedAt >= 0 && now-data.observedAt <= 15;
  const manual = data?.positions.filter(p => p.provenance === "MANUAL") ?? [];
  const other = data?.positions.filter(p => p.provenance !== "MANUAL") ?? [];
  return <Panel title="Mes positions manuelles" aside={<Button variant="outline" className="min-h-11 rounded-xl border-slate-700 bg-transparent text-xs" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={14} className="mr-2" />Actualiser MT5</Button>}>
    <p className="mb-4 text-sm leading-relaxed text-slate-300">Ouvrez, modifiez et clôturez vos trades directement dans MT5 sur PC ou dans l’application MT5 iPhone, sur le même compte. La présence d’une simulation du bot n’ajoute aucun verrou aux opérations manuelles.</p>
    <p className="mb-5 text-xs leading-relaxed text-slate-400">Opérations soumises aux horaires du marché, aux autorisations du compte, aux règles FTMO et aux capacités de MT5. Cette interface n’envoie aucun ordre et ne déplace aucun SL/TP.</p>
    {query.isPending && <p role="status" className="rounded-xl bg-slate-800/50 p-4 text-sm text-slate-300">Lecture des positions MT5… Aucune position de démonstration affichée.</p>}
    {(query.isError || !recent) && !query.isPending && <div role="alert" className="mb-5 rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm leading-relaxed text-amber-100">{query.isError ? query.error.message : data && !data.available ? statusText[data.status] : "Relevé MT5 ancien ou non confirmé. Les positions ci-dessous, si présentes, sont uniquement celles du dernier relevé."}<p className="mt-2 text-xs">Aucun impact sur les statistiques ou la surveillance PAPER. <Link to="/mt5" className="underline underline-offset-4">Connexion MT5 existante</Link>.</p></div>}
    {account && <div className="mb-5 space-y-2 rounded-xl border border-slate-700 bg-slate-800/40 p-4 text-sm"><p className="break-words font-medium">Compte MT5 {account.type} · {account.login} · {account.server}</p><p>Mode : <strong className={account.mode === "HEDGING" ? "text-cyan-300" : "text-amber-200"}>{account.mode === "HEDGING" ? "HEDGING" : account.mode === "NETTING" ? "NETTING / EXCHANGE" : "INCONNU"}</strong> · devise {account.currency}</p><p className="text-xs text-slate-400">Relevé reçu : {date(data?.observedAt)} Europe/Paris. L’heure du relevé ne certifie pas l’âge du dernier tick. Actualisation automatique : 10 s.</p>{account.type === "REAL" && <p className="text-xs text-amber-200">Vous consultez un compte MT5 réel. Le bot reste LIVE OFF ; son essai existant exige toujours un compte DEMO. Ne changez pas de compte pour contourner cette protection.</p>}</div>}
    {account?.mode !== "HEDGING" && account && <div role="alert" className="mb-5 rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm leading-relaxed text-amber-100">{account.mode === "NETTING" ? "En NETTING, les opérations MT5 sur un même instrument peuvent fusionner, réduire ou inverser une position. Ticket, magic et origine de la dernière opération ne prouvent pas l’indépendance de ses différentes contributions." : "Le mode de compte n’est pas vérifié. Aucune indépendance des positions MT5 n’est promise."}<p className="mt-2 text-xs">Le bot PAPER n’est pas une position MT5 : il reste dans son registre fictif séparé. Pour tout futur bot réel, l’attribution et le risque global seraient à vérifier avant la moindre autorisation.</p></div>}
    {recent && !data?.positions.length && <p className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">Aucune position MT5 ouverte dans ce relevé confirmé. Ce constat est distinct de la position PAPER éventuelle.</p>}
    {manual.length > 0 && <div className="space-y-4">{manual.map(p => <BrokerCard key={p.id} position={p} currency={account?.currency ?? "devise inconnue"} recent={recent} />)}</div>}
    {recent && !!data?.positions.length && !manual.length && <p className="mb-4 text-sm leading-relaxed text-slate-400">Aucune position classée manuelle avec certitude dans ce relevé. Les autres positions ne sont pas masquées : elles figurent ci-dessous.</p>}
    {other.length > 0 && <section className="mt-6 space-y-4" aria-label="Autres positions MT5 ou origine non confirmée"><h3 className="text-sm font-semibold text-amber-100">Positions MT5 agrégées, autres experts ou origine à confirmer</h3><p className="text-xs leading-relaxed text-slate-400">Magic 0 seul ne prouve pas une origine manuelle. Aucun ticket de cette liste n’est attribué au bot PAPER, même si son instrument ou son magic ressemble à ceux d’un autre logiciel.</p>{other.map(p => <BrokerCard key={p.id} position={p} currency={account?.currency ?? "devise inconnue"} recent={recent} />)}</section>}
    {data?.exposure && <details className="mt-5 rounded-xl border border-slate-700 p-4 text-xs text-slate-300"><summary className="min-h-8 cursor-pointer font-medium">Préparation du risque global pour une future version réelle</summary><div className="mt-3 space-y-2 leading-relaxed"><p>Compte MT5 uniquement : equity {accountMoney(data.exposure.equity, account?.currency ?? "?")} · marge {accountMoney(data.exposure.margin, account?.currency ?? "?")} · marge libre {accountMoney(data.exposure.marginFree, account?.currency ?? "?")}.</p><p>{data.exposure.brokerPositionCount} position(s) broker, toutes origines incluses ; {data.exposure.missingStops} sans SL exploitable. Les ordres en attente et les pertes potentielles aux SL ne sont pas calculés ici.</p><p className="font-medium text-amber-200">Risque global non certifié · aucune autorisation LIVE. Ni ces chiffres ni un SL présent ne constituent une validation du risque. Aucun ajout du capital PAPER de 20 000 € au compte MT5.</p></div></details>}
    <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-slate-400"><Smartphone size={15} className="mt-0.5 shrink-0" />Pour trader sur iPhone, utilisez MT5 directement. Pour consulter ce tableau de bord distant, Bureau à distance Google reste la solution existante ; aucun port du bridge n’est exposé.</p>
  </Panel>;
}
