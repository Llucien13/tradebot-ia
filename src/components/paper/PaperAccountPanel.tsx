import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Section, actionClass } from "@/components/strategy/StrategyFields";
import { PAPER_DEFAULT_CAPITAL, PAPER_LEGACY_KEY } from "@/lib/paper/model";
import { usePaperTrading } from "./PaperTradingProvider";
import { paperNumber, paperUtc } from "./PaperLayout";

export function PaperAccountPanel() {
  const { state, strategy, configure, setRunning, refreshing, equity } = usePaperTrading();
  const [values, setValues] = useState({ initialCapital: String(PAPER_DEFAULT_CAPITAL), spread: "", slippage: "", commission: "", contractSize: "100", minLot: "0.01", lotStep: "0.01", leverage: "20" });
  const [saving, setSaving] = useState(false);
  const [hasLegacy] = useState(() => { try { return !!localStorage.getItem(PAPER_LEGACY_KEY); } catch { return false; } });
  useEffect(() => {
    if (!state.account) return;
    const a = state.account;
    setValues({ initialCapital: String(a.initialCapital), spread: String(a.spread), slippage: String(a.slippage), commission: String(a.commission), contractSize: String(a.contractSize), minLot: String(a.minLot), lotStep: String(a.lotStep), leverage: String(a.leverage) });
  }, [state.account?.createdAt]);
  const locked = !!state.position || state.running || saving;
  const effectiveRisk = strategy ? Math.min(strategy.riskPercent, 1) : null;
  const initialRisk = effectiveRisk !== null ? Number(values.initialCapital) * effectiveRisk / 100 : null;
  const currentRisk = effectiveRisk !== null && equity !== null ? Math.max(0, equity) * effectiveRisk / 100 : null;
  return <Section title="Paramètres du Paper Trading · EUR" description="Capital initial proposé pour un nouveau compte : 20 000 €. Un capital alternatif, dont 45 000 €, peut être choisi pour une simulation distincte. Le Risk Manager plafonne chaque nouvelle entrée à 1 % de l’equity, ou moins si la stratégie le prévoit, sans modifier ses paramètres ni les backtests.">
    <form className="space-y-5" onSubmit={async e => { e.preventDefault(); setSaving(true); try { await configure({ initialCapital: Number(values.initialCapital), spread: Number(values.spread), slippage: Number(values.slippage), commission: Number(values.commission), contractSize: Number(values.contractSize), minLot: Number(values.minLot), lotStep: Number(values.lotStep), leverage: Number(values.leverage) }); } finally { setSaving(false); } }}>
      <fieldset disabled={locked} className="space-y-4 disabled:opacity-60">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{([["initialCapital", "Capital initial (€)"], ["spread", "Spread simulé ($/oz)"], ["slippage", "Slippage simulé ($/oz/sens)"], ["commission", "Commission ($/oz/sens)"]] as const).map(([key, label]) => <Field key={key} label={label}><Input required type="number" step="any" min={key === "initialCapital" || key === "spread" ? "0.00000001" : "0"} value={values[key]} onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))} className="h-11 rounded-xl bg-background/50 font-mono" /></Field>)}</div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{([["contractSize", "Taille de contrat (oz/lot)"], ["minLot", "Taille minimale (lots)"], ["lotStep", "Pas de volume (lots)"], ["leverage", "Levier de marge simulé"]] as const).map(([key, label]) => <Field key={key} label={label}><Input required type="number" step="any" min={key === "leverage" ? "1" : "0.00000001"} max={key === "leverage" ? "20" : undefined} value={values[key]} onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))} className="h-11 rounded-xl bg-background/50 font-mono" /></Field>)}</div>
      </fieldset>
      <p className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm">Risque enregistré : {strategy ? `${strategy.riskPercent}%` : "en attente de la stratégie"} · plafond appliqué en paper : {effectiveRisk !== null ? `${effectiveRisk}%` : "—"}. Budget initial théorique : {initialRisk !== null && Number.isFinite(initialRisk) ? `${paperNumber(initialRisk)} €` : "—"}.{currentRisk !== null && ` Budget sur l’equity actuelle : ${paperNumber(currentRisk)} €.`} Le volume est recalculé avant chaque entrée et arrondi vers le bas, jamais augmenté pour atteindre le lot minimal ou l’objectif mensuel.</p>
      <Button disabled={locked || Object.values(values).some(v => v.trim() === "")} className={`${actionClass} bg-primary text-primary-foreground hover:bg-primary/90`} type="submit">{saving ? "Conversion EUR/USD et enregistrement…" : state.account ? "Enregistrer une nouvelle simulation" : "Enregistrer le compte à ce capital"}</Button>
    </form>
    <p className="text-xs leading-relaxed text-muted-foreground">Profil de contrat simulé proposé : 100 oz/lot, minimum 0,01 lot (1 oz), pas 0,01 lot et levier 20:1. Ce profil courant pour un CFD or retail n’est pas une spécification de broker ; adaptez-le aux conditions réellement envisagées. Le moteur vérifie le risque avec slippage de sortie et commissions aller-retour, puis la marge et la commission d’entrée. Si le lot minimal dépasse votre budget, aucune position n’est ouverte.</p>
    <p className="text-xs leading-relaxed text-muted-foreground">Les prix, le spread, le slippage et la commission par once restent en USD car XAU/USD est coté en dollars. Le capital, le risque monétaire, les frais totaux, le PnL et le drawdown monétaire sont en EUR. Le spread doit être positif ; les frais doivent être explicitement renseignés, pas supposés réels.</p>
    {state.account && <>
      <p className="text-xs leading-relaxed text-muted-foreground">Conversion de session figée à l’enregistrement : 1 EUR = {paperNumber(state.account.usdPerEur, 6)} USD · Twelve Data du {paperUtc(state.account.fxTime)}. Toutes les conversions utilisent ce même taux réel, connu avant les trades. Les variations futures EUR/USD ne sont pas modélisées ; ce n’est pas une conversion historique par tick.</p>
      <p className="text-xs text-muted-foreground">Capital initial enregistré : {paperNumber(state.account.initialCapital)} € · {paperUtc(state.account.createdAt)}. Une modification exige la pause et aucune position ouverte ; elle archive le registre précédent et crée une nouvelle simulation, sans réécrire ses gains/pertes.</p>
      <Button disabled={refreshing || saving || (!state.running && !strategy?.enabled)} className={`${actionClass} ${state.running ? "border border-border bg-secondary text-foreground hover:bg-secondary/80" : "bg-primary text-primary-foreground hover:bg-primary/90"}`} onClick={() => void setRunning(!state.running)}>{state.running ? "Mettre les nouvelles entrées en pause" : "Démarrer le paper trading"}</Button>
    </>}
    {hasLegacy && <p className="text-xs text-muted-foreground">L’ancien registre USD est conservé séparément. Il n’est pas rebaptisé en euros ni mélangé aux résultats de ce compte EUR.</p>}
    <p className="text-xs leading-relaxed text-muted-foreground">Exécution sur bougies réelles, sans broker : une position à la fois, entrée au prochain open après le signal. Sans position concurrente, l’equity avant entrée égale le solde courant ; le budget évolue donc avec les gains/pertes. Le SL n’est pas garanti : un gap peut dépasser le risque prévu. Marge initiale simplifiée, sans swaps ni modèle complet d’appel de marge d’un broker. Les sorties restent suivies en pause ; aucune taille inférieure au minimum n’est inventée.</p>
  </Section>;
}
export function PaperMetrics() {
  const { state, equity, statistics, unrealized } = usePaperTrading();
  const margin = state.position?.marginEUR ?? 0;
  const values = [["Solde / capital final courant (€)", paperNumber(state.cash)], ["Capital disponible après marge (€)", paperNumber(equity === null ? null : equity - margin)], ["Equity nette (€)", paperNumber(equity)], ["P&L net total (€)", paperNumber(state.account && equity !== null ? equity - state.account.initialCapital : null)], ["Marge initiale réservée (€)", state.account ? paperNumber(margin) : "—"], ["Max drawdown observé", statistics ? `${paperNumber(statistics.maxDrawdownMoney)} € / ${paperNumber(statistics.maxDrawdown)} %` : "—"]];
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">{values.map(([label, value]) => <div key={label} className="min-w-0 rounded-2xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 break-words font-mono text-xl font-semibold">{value}</p></div>)}<p className="col-span-full text-xs text-muted-foreground">{state.account ? `Compte EUR paper uniquement · P&L clôturé : ${paperNumber(state.trades.reduce((sum, t) => sum + t.pnl, 0))} € · latent net de frais de sortie : ${paperNumber(unrealized)} € · valorisation : ${state.lastPrice ? paperUtc(state.lastPrice.time) : "indisponible"}.` : "Capital initial proposé : 300 €. Enregistrez le compte et sa conversion réelle avant tout calcul de performance ; aucun résultat fictif."}</p></div>;
}
