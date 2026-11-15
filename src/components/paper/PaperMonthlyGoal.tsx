import { useEffect, useState } from "react";
import { ShieldCheck, Target, TrendingUp } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { paperMonthlyPerformance, PAPER_MONTHLY_GOAL } from "@/lib/paper/monthly-performance";
import { usePaperTrading } from "./PaperTradingProvider";
import { paperNumber, paperUtc } from "./PaperLayout";

export function PaperMonthlyGoal() {
  const { state, equity } = usePaperTrading();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => window.clearInterval(timer); }, []);
  const m = paperMonthlyPerformance(state, equity, now);
  const month = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(now);
  const projection = m?.projectedMonthly ?? null;
  const warning = projection !== null && projection < PAPER_MONTHLY_GOAL;
  return <section aria-labelledby="paper-monthly-title" className="space-y-5 rounded-2xl border border-primary/25 bg-card p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-center gap-3"><span className="rounded-xl bg-primary/10 p-3 text-primary"><Target className="h-5 w-5" /></span><div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Paper Trading · {month} · UTC</p><h2 id="paper-monthly-title" className="mt-1 text-lg font-bold">Objectif indicatif : +200 € / mois</h2></div></div>
      <span className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary"><ShieldCheck className="h-4 w-4" />Risk Manager prioritaire · ≤ 1 % / trade</span>
    </div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
      ["Equity actuelle", `${paperNumber(equity)} €`],
      ["Gain / perte du mois · net + latent", m?.pnl !== null && m?.pnl !== undefined ? `${paperNumber(m.pnl)} €` : "Indisponible"],
      ["Rendement mensuel réel", m?.returnPercent !== null && m?.returnPercent !== undefined ? `${paperNumber(m.returnPercent)} %` : "Indisponible"],
      ["Gain / perte clôturé ce mois", m ? `${paperNumber(m.realized)} €` : "—"],
    ].map(([label, value]) => <div key={label} className="min-w-0 rounded-xl border border-border bg-background/40 p-3 sm:p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 break-words font-mono text-lg font-semibold sm:text-xl">{value}</p></div>)}</div>
    <div className="space-y-2">
      <div className="flex flex-wrap justify-between gap-2 text-sm"><span>Progression nette : {m?.pnl !== null && m?.pnl !== undefined ? `${paperNumber(m.pnl)} € / +200 €` : "en attente de données"}</span><span className="font-mono text-primary">{m?.progress !== null && m?.progress !== undefined ? `${paperNumber(m.progress)} %` : "—"}</span></div>
      <Progress aria-label="Progression vers l’objectif mensuel indicatif" value={m?.progress ?? 0} className="h-3 rounded-full bg-secondary [&>div]:rounded-full [&>div]:bg-primary" />
      <p className="text-xs text-muted-foreground">La barre est bornée à 0–100 % ; les pertes et les gains au-delà de l’objectif restent affichés en valeur réelle.</p>
    </div>
    <div className={`rounded-xl border p-4 ${warning ? "border-destructive/40 bg-destructive/5" : "border-border bg-background/40"}`}>
      <h3 className="flex items-center gap-2 text-sm font-semibold"><TrendingUp className="h-4 w-4 text-primary" />Projection au rythme réellement observé</h3>
      {projection === null ? <p className="mt-2 text-sm">Données insuffisantes pour une projection ou pour juger l’objectif réaliste. Minimum de lecture : 7 jours calendaires observés et 5 trades clôturés sur ce compte{m ? ` (actuellement ${paperNumber(m.elapsedDays, 1)} jours et ${m.closedTrades} trades)` : ""}.</p> : <>
        <p className="mt-2 font-mono text-xl font-semibold">{paperNumber(projection)} € / mois</p>
        <p role="status" className="mt-2 text-sm">{warning ? "L’objectif de +200 € par mois n’est pas réaliste au rythme actuellement observé. Aucun risque, levier ou nombre de trades ne sera augmenté pour le poursuivre." : "Le rythme moyen observé atteint l’objectif indicatif, sans garantie qu’il se maintienne. Aucune adaptation de la stratégie n’est déclenchée."}</p>
      </>}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Projection linéaire = PnL net des trades clôturés depuis la création du compte ÷ jours calendaires observés × jours du mois courant. Les pauses et jours sans trade sont inclus. Aucun backtest, gain latent, trade fictif ou hausse de fréquence n’alimente cette projection. Ce rythme descriptif n’est ni une promesse ni une prévision fiable ; le seuil minimal ne garantit pas sa robustesse.</p>
    </div>
    {m ? <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
      <p>Période mensuelle : depuis le {paperUtc(m.start)} · dernier relevé : {paperUtc(m.asOf)}{state.lastPrice ? ` · prix de valorisation : ${paperUtc(state.lastPrice.time)}` : " · aucune cotation paper observée"}. Les valeurs ne sont pas des cotations en temps réel et restent figées si le flux est indisponible.</p>
      {m.missingBoundary ? <p className="text-destructive">Une position traverse le début du mois sans valorisation exacte à cette frontière : gain/perte d’equity, rendement et progression mensuels indisponibles, plutôt qu’un prix inventé. Le PnL clôturé reste consultable.</p> : m.pnl === null ? <p>Aucun relevé d’equity disponible dans le mois courant. Les anciennes performances ne sont pas attribuées à ce mois.</p> : <p>Base mensuelle : {paperNumber(m.baseline)} €. Rendement = variation d’equity nette / base mensuelle ; inclut les gains/pertes latents et les coûts simulés de liquidation. {state.account && state.account.createdAt > m.monthStart ? "Compte créé en cours de mois : période partielle, non annualisée. " : ""}Le PnL clôturé est comptabilisé à la date de sortie et peut différer de la variation d’equity.</p>}
      {m.requiredReturn !== null && <p>+200 € représente {paperNumber(m.requiredReturn)} % de la base mensuelle (66,67 % avec 300 €). C’est un objectif ambitieux, jamais une consigne d’exécution.</p>}
    </div> : <p className="text-sm text-muted-foreground">Capital initial proposé : 300 €. Enregistrez le compte Paper Trading pour suivre ses résultats réels ; aucun résultat ni projection n’est inventé.</p>}
    <p className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">Les gains et pertes sont automatiquement intégrés à l’equity. Chaque nouvelle position est dimensionnée sur l’equity disponible, avec le moindre du risque enregistré et de 1 %, puis contrôlée pour la marge et le lot minimal. Cet objectif est uniquement visuel : il ne modifie jamais stratégie, risque, levier ou fréquence. Un gap de marché peut toutefois dépasser la perte prévue au stop.</p>
  </section>;
}
