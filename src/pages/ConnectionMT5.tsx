import { Cable } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LocalMT5Panel } from "@/components/market-data/LocalMT5Panel";
import { useFTMOWorkspace } from "@/components/ftmo/FTMOWorkspace";
import { MT5ClockEvidence } from "@/components/market-data/MT5ClockEvidence";

const dateTime = (time: number) => new Date(time * 1000).toLocaleString("fr-FR", { timeZone: "Europe/Paris", timeZoneName: "short" });

export default function ConnectionMT5() {
  const { data, busy, action } = useFTMOWorkspace();
  const feed = data?.feed;
  return <>
    <LocalMT5Panel goldFocus />
    <MT5ClockEvidence />
    <section className="space-y-4 rounded-3xl border border-border bg-card p-5 sm:p-6">
      <h2 className="text-xl font-bold">Flux du simulateur FTMO 20K · XAUUSD</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">Le test ci-dessous lit XAUUSD sur FTMO-Demo, EUR/USD et les spécifications du contrat. Il ne démarre pas le bot et n’envoie aucun ordre. Le capital virtuel reste indépendant du solde MT5 ; les anciens backtests VT Markets conservent XAUUSD-ECN.</p>
      <div className="rounded-2xl border border-border bg-secondary/40 p-4 text-sm">
        <p className="font-semibold">Données nécessaires en plus de la connexion MT5</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Compte DEMO sur FTMO-Demo, contrat XAUUSD linéaire en USD et volumes valides.</li>
          <li>BID/ASK XAUUSD et EUR/USD valides, ticks de moins de 15 secondes. Un marché fermé ne valide pas ce test.</li>
          <li>Historiques XAUUSD : M15 ≥ 201 bougies ; M5, M30, H1, H4 et D1 ≥ 8 chacun. Les lectures demandent respectivement 4 000, 500 et 400 bougies pour D1, sans exiger que toutes soient disponibles.</li>
          <li>Dernière bougie M15 correspondant au quart d’heure du tick MT5. Aucun historique ni taux de change n’est inventé.</li>
        </ul>
      </div>
      <Button disabled={busy} onClick={() => void action("feed")} variant="outline" className="min-h-12 rounded-xl"><Cable className="mr-2 h-4 w-4" />{busy ? "Action FTMO en cours…" : "Tester le flux FTMO / MT5"}</Button>
      <p role="status" className="text-sm font-semibold">{busy ? "Patientez pendant la lecture. Le bot n’est pas démarré par le test." : data?.connected && feed ? "Dernier test du flux validé · PAPER uniquement" : "Aucun flux FTMO confirmé. En cas d’échec, le motif reste affiché en haut de cette page jusqu’à la prochaine action."}</p>
      {feed && <div className="space-y-2 rounded-2xl border border-border bg-secondary/40 p-4 text-sm">
        <p className="font-semibold">Source officielle MT5 · {feed.symbol} · {feed.accountType} · {feed.company} / {feed.server}</p>
        <p>BID {feed.bid.toFixed(2)} · ASK {feed.ask.toFixed(2)} · spread {feed.spread.toFixed(3)} USD/oz</p>
        <p>{feed.fxSymbol} : 1 EUR = {feed.fx.toFixed(5)} USD · tick XAUUSD {dateTime(feed.time)} · tick EUR/USD {dateTime(feed.fxTime)} · Europe/Paris</p>
        <p className="text-xs text-muted-foreground">UTC XAUUSD : {new Date(feed.time * 1000).toISOString()} · UTC EUR/USD : {new Date(feed.fxTime * 1000).toISOString()}. Paris applique automatiquement UTC+1 en hiver et UTC+2 en été ; les contrôles comparent uniquement les timestamps Unix.</p>
        <p className="text-xs text-muted-foreground">Contrat {feed.contract.size} oz/lot · lots {feed.contract.minLot} à {feed.contract.maxLot}, pas {feed.contract.step} · tick size/value {feed.contract.tickSize} / {feed.contract.tickValue}<br />Swaps MT5 bruts : mode {feed.contract.swapMode}, long {feed.contract.swapLong}, short {feed.contract.swapShort}. Ne copiez pas des points comme des USD : vérifiez leur conversion auprès du broker.</p>
        {feed.bars && <p className="mt-2 text-xs">Bougies XAUUSD lues : {Object.entries(feed.bars).map(([unit, count]) => `${unit.toUpperCase()} : ${count}`).join(" · ")}</p>}
        {(Date.now()/1000-feed.time > 15 || Date.now()/1000-feed.fxTime > 15) && <p className="font-semibold">Cotation ancienne : aucune nouvelle entrée autorisée. Ce résultat est celui du dernier test, pas un suivi continu du flux.</p>}
      </div>}
    </section>
  </>;
}
