import { lazy, Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { useFTMOWorkspace } from "@/components/ftmo/FTMOWorkspace";

const FTMOHistory = lazy(() => import("@/components/ftmo/FTMOHistory").then(module => ({ default: module.FTMOHistory })));
const FTMOLedger = lazy(() => import("@/components/ftmo/FTMOLedger").then(module => ({ default: module.FTMOLedger })));
const ArchivedHistoryDownloads = lazy(() => import("@/components/ftmo/ArchivedHistoryDownloads"));
const RecordedPerformanceReport = lazy(() => import("@/components/ftmo/RecordedPerformanceReport"));

export default function Journal() {
  const { data } = useFTMOWorkspace();
  const [showLedger, setShowLedger] = useState(false), [showReferences, setShowReferences] = useState(false), [showArchives, setShowArchives] = useState(false);
  return <>
    <section className="space-y-4 rounded-3xl border border-border bg-card p-5 sm:p-6"><h2 className="text-xl font-bold">Historique et performances FTMO 20K</h2><p className="text-sm leading-relaxed text-muted-foreground">Le registre du challenge PAPER et les backtests originaux sont distincts. Les graphiques et archives volumineux ne sont ouverts qu’à votre demande. Aucun recalcul, test ni trade n’est lancé en consultant cette rubrique.</p></section>
    <Suspense fallback={<p role="status" className="rounded-2xl border border-border bg-card p-5 text-sm">Chargement du rapport enregistré…</p>}><RecordedPerformanceReport /></Suspense>
    <Suspense fallback={<p role="status" className="rounded-2xl border border-border bg-card p-5 text-sm">Chargement de la vue historique…</p>}>
      {showLedger && data ? <FTMOLedger data={data} /> : <section className="space-y-4 rounded-3xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Registre PAPER et courbe d’equity</h2><p className="text-sm text-muted-foreground">Phases séparées, transactions, gains journaliers et mensuels, exports du registre.</p><Button disabled={!data} variant="outline" className="min-h-11 rounded-xl" onClick={() => setShowLedger(true)}>Afficher le registre et les performances</Button>{!data && <p className="text-xs text-muted-foreground">Registre FTMO indisponible tant que la passerelle ne le retourne pas.</p>}</section>}
      {showReferences ? <FTMOHistory /> : <section className="space-y-4 rounded-3xl border border-primary/25 bg-card p-5"><h2 className="text-lg font-semibold">Archives GOLD M15 · 2,5R et 5R</h2><p className="text-sm text-muted-foreground">Références originales 2025 / 2026. La variante 5R reste une comparaison, sans changement de stratégie.</p><Button variant="outline" className="min-h-11 rounded-xl" onClick={() => setShowReferences(true)}>Charger les références originales</Button></section>}
      {showArchives ? <ArchivedHistoryDownloads /> : <section className="space-y-4 rounded-3xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Historiques antérieurs conservés</h2><p className="text-sm text-muted-foreground">Consultation et export des résultats enregistrés, sans réactiver les anciens moteurs. Aucune suppression.</p><Button variant="outline" className="min-h-11 rounded-xl" onClick={() => setShowArchives(true)}>Lire les historiques archivés</Button></section>}
    </Suspense>
  </>;
}
