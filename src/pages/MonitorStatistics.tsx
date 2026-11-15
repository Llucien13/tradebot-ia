import { EquityChart, Metric, money, number, Panel, tone } from "@/components/monitor/MonitorCards";
import { useMonitor } from "@/components/monitor/MonitorLayout";

export default function MonitorStatistics() {
  const { data, fresh, connected } = useMonitor();
  const m = data?.metrics;
  const rows = [
    ["Trades clôturés", m?.count], ["Gagnants / perdants / neutres", m ? `${m.wins} / ${m.losses} / ${m.neutral}` : "—"],
    ["Win rate", number(m?.winRate, " %")], ["Gain moyen", money(m?.averageWin)], ["Perte moyenne", money(m?.averageLoss)],
    ["Profit factor", m?.profitFactorInfinite ? "∞ · aucune perte clôturée" : number(m?.profitFactor)],
    ["Résultat moyen par trade", money(m?.averageEUR)], ["Résultat moyen en R", number(m?.averageR, " R")],
    ["Drawdown observé maximal", money(m?.drawdownEUR)], ["Drawdown observé maximal (%)", number(m?.drawdownPercent, " %")],
  ];
  return <div className="space-y-6"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Les chiffres, sans extrapolation</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Statistiques PAPER</h1><p className="mt-3 text-sm leading-relaxed text-slate-400">Transactions clôturées du seul essai indépendant. Les résultats du challenge FTMO ne sont jamais mélangés.</p></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Capital initial de référence" value="20 000 €" /><Metric label={connected ? "Solde virtuel courant" : "Dernier solde enregistré"} value={money(m?.balance)} /><Metric label="P&L réalisé net clôturé" value={money(m?.realized)} color={tone(m?.realized)} /><Metric label={fresh ? "Exposition latente · hors frais d’entrée" : "Exposition latente non certifiable"} value={fresh ? money(data?.floatingEUR) : "—"} color={tone(fresh ? data?.floatingEUR : null)} /></div>
    <Panel title="Résultats réalisés par période"><div className="grid grid-cols-2 gap-5 lg:grid-cols-4">{[["Aujourd’hui", m?.periods.today], ["7 jours calendaires", m?.periods.week], ["Mois en cours", m?.periods.month], ["Total clôturé", m?.periods.total]].map(([label, value]) => <div key={String(label)}><p className="text-xs text-slate-400">{label}</p><p className={`mt-2 text-xl font-semibold tabular-nums ${tone(value as number | undefined)}`}>{money(value as number | undefined)}</p></div>)}</div><p className="mt-4 text-xs leading-relaxed text-slate-400">Périodes Europe/Paris, date de clôture ; 7 jours = aujourd’hui et les 6 jours précédents. Les frais d’entrée d’une position encore ouverte sont déjà débités du solde, mais pas inclus dans le réalisé des trades clôturés.</p></Panel>
    <EquityChart />
    <Panel title="Qualité des résultats"><dl className="grid grid-cols-2 gap-5 lg:grid-cols-3">{rows.map(([label, value]) => <div key={String(label)} className="min-w-0"><dt className="text-xs text-slate-400">{label}</dt><dd className="mt-2 break-words text-lg font-semibold tabular-nums">{value ?? "—"}</dd></div>)}</dl>
      <div className="mt-6 space-y-2 border-t border-slate-800 pt-4 text-xs leading-relaxed text-slate-400"><p>Win rate = gagnants / tous les trades clôturés, neutres inclus. Profit factor = somme des P&L positifs / valeur absolue des P&L négatifs. Sans perte mais avec gains : ∞ ; sans résultat exploitable : —.</p><p>R = résultat net enregistré / risque initial en euros. Moyenne R sur {m?.rCount ?? 0} trade(s) avec risque positif enregistré ; les données manquantes ne sont pas imputées.</p><p>Drawdown = baisse maximale depuis un plus-haut des observations d’equity disponibles, référence initiale 20 000 €. Le pourcentage est rapporté au plus-haut correspondant. Ce n’est pas un drawdown intrabar et les interruptions peuvent sous-estimer les excursions.</p><p>{data?.costModel || "Modèle de coûts disponible après lecture du registre."}</p></div>
    </Panel>
    <Panel title="Historique quotidien réalisé"><p className="mb-4 text-xs text-slate-400">90 derniers jours avec clôtures ; aucun jour sans transaction n’est inventé.</p>{m?.daily.length ? <div className="grid max-h-96 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{m.daily.slice(-90).reverse().map(day => <div key={day.day} className="flex items-center justify-between gap-3 rounded-xl bg-slate-800/50 px-4 py-3 text-sm"><span>{day.day}</span><span className={`font-medium tabular-nums ${tone(day.pnl)}`}>{money(day.pnl)}</span></div>)}</div> : <p className="text-sm text-slate-400">Pas encore de données de clôture.</p>}</Panel>
  </div>;
}
