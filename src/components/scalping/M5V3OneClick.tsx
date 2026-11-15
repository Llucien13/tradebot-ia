import { useEffect, useRef, useState } from "react";
import { Play, Waves, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useMT5DataSession } from "@/lib/mt5-data-session";
import { prepareV3OneClick, runV3OneClick, type V3PhaseResult, type V3Prepared } from "@/lib/scalping/m5-v3-one-click";
import type { V3Result } from "@/lib/scalping/m5-v3-model";
import { M5V3Panel } from "./M5V3Panel";
import { M5V3OneClickResults } from "./M5V3OneClickResults";
import { M5V3MissingInputs } from "./M5V3MissingInputs";
import { V3MissingInputs, type V3MissingField } from "@/lib/scalping/m5-v3-profile";

export function M5V3OneClick() {
  const { history } = useMT5DataSession("M5");
  const [busy, setBusy] = useState(false), [percent, setPercent] = useState(0), [stage, setStage] = useState("Prêt à vérifier votre historique sauvegardé");
  const [error, setError] = useState(""), [details, setDetails] = useState(false), [prepared, setPrepared] = useState<V3Prepared | null>(null);
  const [missing, setMissing] = useState<V3MissingField[]>([]);
  const [development, setDevelopment] = useState<V3PhaseResult | null>(null), [validation, setValidation] = useState<V3PhaseResult | null>(null);
  const generation = useRef(0), running = useRef(false), worker = useRef<Worker | null>(null), rejectRun = useRef<((e: Error) => void) | null>(null);
  useEffect(() => () => { generation.current++; worker.current?.terminate(); rejectRun.current?.(new Error("Page fermée")); }, []);
  useEffect(() => {
    let active = true;
    void prepareV3OneClick(history).then(input => {
      if (!active || running.current) return;
      setPrepared(input); setMissing([]); setError("");
      setStage("Profil V3 sauvegardé automatiquement · plafond MT5 confirmé : 100 lots · prêt au lancement PAPER");
    }).catch(e => {
      if (!active || running.current) return;
      if (e instanceof V3MissingInputs) setMissing(e.fields);
      setError(e instanceof Error ? e.message : "Vérification du profil impossible.");
    });
    return () => { active = false; };
  }, [history]);
  const launch = async () => {
    if (running.current) return;
    running.current = true;
    const id = ++generation.current;
    setBusy(true); setError(""); setPercent(1); setStage("Chargement du profil et des historiques sauvegardés"); setDevelopment(null); setValidation(null);
    try {
      const input = await prepareV3OneClick(history);
      if (generation.current !== id) return;
      setMissing([]); setPrepared(input); setPercent(10);
      console.info("V3_ONE_CLICK_DATA", { developmentBars: input.development.coverage.testedCount, validationBars: input.validation.coverage.testedCount, warmup: input.development.coverage.warmupCount });
      const output = await runV3OneClick(input, (request, progress) => new Promise<V3Result>((resolve, reject) => {
        const req = request as { runId: string };
        const instance = new Worker(new URL("../../lib/scalping/m5-v3.worker.ts", import.meta.url), { type: "module" }); worker.current = instance; rejectRun.current = reject;
        const stop = () => { instance.terminate(); worker.current = null; rejectRun.current = null; };
        instance.onmessage = event => {
          if (event.data.runId !== req.runId) { stop(); reject(new Error("Réponse V3 non corrélée : aucun résultat utilisé. Action : rechargez la page et conservez vos sauvegardes.")); return; }
          if (event.data.type === "progress") { progress(event.data.percent); return; }
          stop();
          if (event.data.type === "result" && event.data.result?.execution?.runId === req.runId) resolve(event.data.result);
          else reject(new Error(`${event.data.message ?? "Le moteur V3 n’a pas produit de résultat."} Action : consultez Voir les détails pour vérifier le lot et le calendrier.`));
        };
        instance.onerror = () => { stop(); reject(new Error("Le moteur V3 a été interrompu. Action : conservez vos sauvegardes et consultez le diagnostic dans Voir les détails ; aucun résultat fictif affiché.")); };
        instance.postMessage(request);
      }), (n, label) => { if (generation.current === id) { setPercent(n); setStage(label); } }, () => generation.current !== id, value => { if (generation.current === id) setDevelopment(value); });
      if (generation.current !== id) return;
      setDevelopment(output.development); setValidation(output.validation);
      console.info("V3_ONE_CLICK_COMPLETED", { development: output.development.result.stats, validation: output.validation.result.stats, reused: [output.development.reused, output.validation.reused] });
    } catch (e) {
      if (generation.current !== id) return;
      const message = e instanceof Error ? e.message : "Backtest impossible. Action : ouvrez Voir les détails pour vérifier les données sauvegardées.";
      if (e instanceof V3MissingInputs) setMissing(e.fields);
      setError(message); setStage("Backtest non terminé"); console.error("V3_ONE_CLICK_FAILED", message);
    } finally { if (generation.current === id) { setBusy(false); running.current = false; } }
  };
  return <section className="space-y-6 rounded-3xl border border-primary/30 bg-card p-5 sm:p-8"><div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-widest text-primary">PAPER · aucun ordre réel</p><h2 className="mt-2 flex items-center gap-3 text-2xl font-bold sm:text-3xl"><Waves className="h-8 w-8 text-primary" />Votre backtest M5 V3</h2><p className="mt-2 text-sm text-muted-foreground">Juillet 2026 · XAUUSD-ECN · 300 USD · risque maximal 1 %</p></div></div><Button disabled={busy} onClick={() => void launch()} className="min-h-16 w-full rounded-2xl bg-primary px-8 text-base font-bold text-primary-foreground shadow-sm sm:w-auto"><Play className="mr-3 h-5 w-5" />{busy ? "BACKTEST EN COURS…" : "LANCER MON BACKTEST"}</Button><div role="status" className="space-y-2"><p className="text-sm">{stage}{busy ? ` · ${Math.round(percent)} %` : ""}</p>{busy && <Progress value={percent} className="h-3 rounded-full bg-secondary [&>div]:bg-primary" />}</div>{error && <p role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm">{error}</p>}{missing.length > 0 && <M5V3MissingInputs fields={missing} disabled={busy} onError={setError} />}<M5V3OneClickResults development={development} validation={validation} details={details} /><Button variant="outline" onClick={() => setDetails(v => !v)} aria-expanded={details} className="min-h-11 rounded-xl"><ChevronDown className="mr-2 h-4 w-4" />{details ? "Masquer les détails" : "Voir les détails"}</Button>{details && <div className="space-y-4"><p className="rounded-xl border border-border p-4 text-xs">Développement 1–20 juillet puis validation 21–31 juillet, chacun à 300 USD. Contrat 100 oz/lot · minimum/pas 0,01 lot · commission 3 USD/lot/côté (= 0,03 USD/oz/côté) · marge conservative 840 USD/lot. Volume maximal, règles de stratégie et calendrier issus du profil enregistré. {prepared ? `Hypothèses enregistrées : spread ${prepared.costs.spread} USD/oz, slippage ${prepared.costs.slippage} USD/oz/sens.` : "Spread/slippage : hypothèses du profil enregistré, contrôlées au clic."}</p><M5V3Panel /></div>}</section>;
}
