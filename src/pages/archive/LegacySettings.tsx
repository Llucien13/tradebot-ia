import { AppNavigation } from "@/components/navigation/AppNavigation";
import { Link } from "react-router-dom";
import { TradingStateBadge } from "@/components/ui/trading/TradingStateBadge";
import { useMarketData } from "@/components/market-data/MarketDataProvider";
import { Settings as SettingsIcon, Shield, Bell, Globe, Users, Activity, Bot } from "lucide-react";

export default function Settings() {
  const { source } = useMarketData();
  const isDemo = source === "DEMO";

  return (
    <div className="min-h-screen bg-background text-foreground lg:flex">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-card/50 lg:flex">
        <div className="flex items-center gap-3 border-b border-border px-5 py-6">
          <div className="rounded-xl bg-primary/15 p-2 text-primary"><SettingsIcon className="h-6 w-6" /></div>
          <div><p className="text-lg font-bold tracking-tight">TradeBot IA</p><p className="text-xs text-muted-foreground">Terminal de trading</p></div>
        </div>
        <nav aria-label="Navigation principale" className="flex-1 overflow-y-auto px-3 py-5"><AppNavigation /></nav>
        <div className="m-4 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs"><p className="mb-1 font-semibold text-primary">Marché {isDemo ? "DEMO fictif" : "Twelve Data"}</p><p className="leading-relaxed text-muted-foreground">MT5 : historique de backtest distinct.<br />Aucun ordre réel.</p></div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/50 px-4 py-4 sm:px-6">
          <div><p className="text-sm font-medium">Paramètres <span className={`ml-2 rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wider ${source === "TWELVE_DATA" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-primary/30 bg-primary/10 text-primary"}`}>{source}</span></p></div>
          <div className="flex flex-wrap items-center gap-3"><TradingStateBadge>PAPER</TradingStateBadge><span className="text-xs text-muted-foreground">Simulation uniquement · aucun ordre réel</span></div>
        </header>

        <main className="mx-auto max-w-[1600px] space-y-5 px-4 py-6 pb-28 sm:px-6 lg:pb-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-primary">TradeBot IA / Paramètres</p><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Paramètres</h1><p className="mt-2 text-sm text-muted-foreground">Configuration du bot et préférences utilisateur.</p></div>
            <span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">Simulation uniquement</span>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="mb-4 font-semibold">Trading</h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between"><span className="text-sm">Mode trading</span><span className="font-medium">Paper Trading</span></div>
                <div className="flex items-center justify-between"><span className="text-sm">Symbole par défaut</span><span className="font-mono text-primary">XAU/USD</span></div>
                <div className="flex items-center justify-between"><span className="text-sm">Risque par trade</span><span className="font-mono text-primary">2%</span></div>
                <div className="flex items-center justify-between"><span className="text-sm">Positions max</span><span className="font-mono text-primary">5</span></div>
                <div className="flex items-center justify-between"><span className="text-sm">Limite perte journalière</span><span className="font-mono text-primary">$500</span></div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="mb-4 font-semibold">Notifications</h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between"><span className="text-sm">Alertes de signal</span><span className="flex items-center gap-3"><Bell className="h-4 w-4 text-primary" /><span className="font-medium">Activées</span></span></div>
                <div className="flex items-center justify-between"><span className="text-sm">Alertes de trade</span><span className="flex items-center gap-3"><Bell className="h-4 w-4 text-primary" /><span className="font-medium">Activées</span></span></div>
                <div className="flex items-center justify-between"><span className="text-sm">Alertes de risque</span><span className="flex items-center gap-3"><Bell className="h-4 w-4 text-primary" /><span className="font-medium">Activées</span></span></div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="mb-4 font-semibold">Marché & API</h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between"><span className="text-sm">Source de données</span><span className="font-mono text-primary">Twelve Data (DEMO)</span></div>
                <div className="flex items-center justify-between"><span className="text-sm">Broker connecté</span><span className="text-muted-foreground">Non</span></div>
                <div className="flex items-center justify-between"><span className="text-sm">Version</span><span className="font-mono text-primary">v1.0.0</span></div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="mb-4 font-semibold">A propos</h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between"><span className="text-sm">Utilisateur</span><span className="font-mono text-primary">Trader Pro</span></div>
                <div className="flex items-center justify-between"><span className="text-sm">Langue</span><span className="font-mono text-primary">Français</span></div>
                <div className="flex items-center justify-between"><span className="text-sm">Fuseau horaire</span><span className="font-mono text-primary">UTC</span></div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-4 font-semibold">Information légale</h2>
            <p className="text-xs text-muted-foreground">
              TradeBot IA est un outil d&apos;analyse technique et de paper trading à usage éducatif.
              Aucune connexion à un broker n&apos;est établie. Aucun ordre réel n&apos;est exécuté.
              Toutes les données affichées sont fictives et à titre indicatif uniquement.
            </p>
          </div>
        </main>

        <nav aria-label="Navigation mobile" className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card p-2 lg:hidden"><AppNavigation mobile /></nav>
      </div>
    </div>
  );
}