import { useState } from "react";
import { z } from "zod";
import { Download, Microscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ftmoRequest } from "@/lib/ftmo-api";

const evidenceSchema = z.object({
  mode: z.literal("PAPER"), liveEnabled: z.literal(false), ordersSent: z.literal(false),
  server: z.string(), conversionApplied: z.boolean(), conclusion: z.string(),
  samples: z.array(z.record(z.unknown())),
  nativeProbe: z.record(z.unknown()).nullable(), nativeProbeError: z.string().nullable(),
  tests: z.object({ passed: z.boolean(), tests: z.number(), failures: z.number(), errors: z.number(), output: z.string() }),
}).passthrough();
type Evidence = z.infer<typeof evidenceSchema>;

export function MT5ClockEvidence() {
  const [data, setData] = useState<Evidence | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const collect = async () => {
    setBusy(true); setError(""); setData(null);
    try { setData(await ftmoRequest("clock-evidence", evidenceSchema)); }
    catch (e) { setError(e instanceof Error ? e.message : "Relevé impossible."); }
    finally { setBusy(false); }
  };
  const download = () => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "tradebot-clock-evidence.json"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="space-y-4 rounded-3xl border border-primary/25 bg-card p-5 sm:p-6">
    <div className="flex items-start gap-3"><span className="rounded-2xl bg-primary/10 p-3 text-primary"><Microscope className="h-5 w-5" /></span><div><h2 className="text-xl font-bold">Validation de la normalisation UTC</h2><p className="mt-1 text-sm text-muted-foreground">Ticks bruts XAUUSD/EURUSD, bougies M15 et horloges natives MT5 confrontés automatiquement. Aucun ordre.</p></div></div>
    <p className="text-sm leading-relaxed text-muted-foreground">Le script en lecture seule <code>src/mt5_bridge/TradeBotClockProbe.mq5</code> produit la preuve native. L’encodage est identifié par comparaison aux horloges GMT et serveur. Une conversion serveur exige aussi la règle annuelle de fuseau confirmée par FTMO, pas seulement GMT+3 en octobre. Preuve valable deux minutes ; aucune compensation n’est apprise de l’âge du tick. Instructions : <code>src/mt5_bridge/HORODATAGES.md</code>.</p>
    <div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={() => void collect()} variant="outline" className="min-h-11 rounded-xl">{busy ? "Lectures et autotests en cours…" : "Relevé croisé + autotests"}</Button>{data && <Button onClick={download} variant="outline" className="min-h-11 rounded-xl"><Download className="mr-2 h-4 w-4" />Télécharger la preuve JSON</Button>}</div>
    {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">{error}</p>}
    {data && <div className="space-y-3 rounded-2xl border border-border bg-secondary/40 p-4 text-sm">
      <p className="font-semibold">{data.server} · {data.tests.tests} autotests exécutés · {data.tests.passed ? "réussis" : "ÉCHEC : validation du flux bloquée"}</p>
      <p>{data.conclusion}</p>
      <p className="text-xs text-muted-foreground">{data.conversionApplied ? "Conversion heure serveur → UTC validée sur le relevé courant. Le fuseau confirmé est appliqué à la date de chaque bougie, jamais à partir de l’âge du tick." : "Aucune conversion serveur appliquée sans preuve. Les dates UTC démontrées restent inchangées."}</p>
      {data.nativeProbeError && <p className="break-words text-xs text-muted-foreground">Lecture du relevé natif : {data.nativeProbeError}</p>}
      <p className="text-xs text-muted-foreground">La comparaison aux horloges natives ne repose pas uniquement sur l’âge du tick. TimeGMT dépend de l’horloge Windows et TimeTradeServer est estimé par le terminal : ces valeurs ne remplacent pas une référence UTC externe si Windows n’est pas synchronisé.</p>
      <details><summary className="cursor-pointer font-semibold">Résultats et valeurs brutes</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-border bg-background p-3 text-xs">{JSON.stringify(data, null, 2)}</pre></details>
    </div>}
  </section>;
}
