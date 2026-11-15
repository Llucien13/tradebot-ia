import { useCallback, useEffect, useState } from "react";
import { Archive, Download, ShieldCheck, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { exportFullBrowserBackup } from "@/lib/full-browser-backup";
import { useMT5DataSession, updateMT5DataSession } from "@/lib/mt5-data-session";
import { readPaperState } from "@/lib/paper/model";
import { STRATEGY_STORAGE_KEY } from "@/lib/strategies";
import { SCALPING_KEY } from "@/lib/scalping/model";
import {
  availableResults, backupSchema, collectStorage, decodeBackup, downloadBackup,
  listBackupSummaries, readBackup, restoreConfigurations, saveBackup, testRestoration,
  type BackupSummary, type BackupSnapshot,
} from "@/lib/backup";

export function SafetyBackup() {
  const session = useMT5DataSession();
  const m5Session = useMT5DataSession("M5");
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<BackupSummary[]>([]), [selected, setSelected] = useState("");
  const [snapshot, setSnapshot] = useState<BackupSnapshot | null>(null);
  const [verified, setVerified] = useState("");
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  const create = useCallback(async () => {
    const storage = collectStorage(), results = availableResults();
    const limitations = [
      "Les backtests dont le composant a déjà été démonté avant cette sauvegarde ne sont plus accessibles : aucune récupération prétendue.",
      "Seuls les rapports d’optimisation transmis par leur écran de résultats sont accessibles à cette capture. Les anciens rapports non exposés par l’interface ne sont pas certifiés sauvegardés.",
      "Les clés API du serveur et les fichiers du terminal MT5 ne sont pas accessibles depuis ce navigateur et ne sont pas inclus.",
      "Le registre Paper et ses archives sont conservés comme données brutes, sans réexécution ni restauration automatique du moteur.",
    ];
    if (!storage.some(e => e.key === STRATEGY_STORAGE_KEY)) limitations.push("Configuration H1 enregistrée : Non disponible.");
    if (!storage.some(e => e.key === SCALPING_KEY)) limitations.push("Configuration Scalping enregistrée : Non disponible. Aucun défaut n’est présenté comme une configuration sauvegardée.");
    if (!session.history) limitations.push("Bougies MT5 en mémoire : Non disponible.");
    for (const [kind, label] of [["backtest-h1", "Résultat de backtest H1"], ["backtest-scalping", "Résultat de backtest Scalping"], ["optimization", "Rapport d’optimisation"]] as const) {
      if (!results.some(r => r.kind === kind)) limitations.push(`${label} accessible : Non disponible.`);
    }
    const saved = await saveBackup({
      format: "tradebot-backup", version: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(),
      codeRevision: "73d9653bf82451db3c621ccfd0f6b1dacb747550 · séparation UI M1/M5/H1", storage,
      mt5: session.history, connection: { terminalPath: session.terminalPath, symbol: session.symbol,
        startDate: session.startDate, endDate: session.endDate, warmup: session.warmup },
      results, limitations,
    });
    if (m5Session.history && m5Session.history !== session.history) {
      const m5Copy = await saveBackup({ ...saved, id: crypto.randomUUID(), mt5: m5Session.history, connection: { terminalPath: m5Session.terminalPath, symbol: m5Session.symbol, startDate: m5Session.startDate, endDate: m5Session.endDate, warmup: m5Session.warmup } });
      await testRestoration(m5Copy.id);
    }
    await testRestoration(saved.id);
    setSnapshot(saved); setSelected(saved.id); setVerified(saved.id); setEntries(await listBackupSummaries());
    setMessage("Les données incluses ont été écrites durablement, relues et restaurées à l’identique dans une copie de vérification. Exportez aussi le fichier JSON avant le nettoyage.");
    console.info("[TradeBot Backup] Sauvegarde et restauration de copie vérifiées", {
      id: saved.id, mt5Candles: saved.mt5?.candles.length ?? 0,
      h1Stored: storage.some(e => e.key === STRATEGY_STORAGE_KEY), scalpingStored: storage.some(e => e.key === SCALPING_KEY),
      backtestsH1: results.filter(r => r.kind === "backtest-h1").length,
      backtestsScalping: results.filter(r => r.kind === "backtest-scalping").length,
      optimizationReports: results.filter(r => r.kind === "optimization").length,
      storageEntries: storage.length, limitations: saved.limitations,
    });
    return saved;
  }, [session, m5Session]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setBusy(true); setError("");
    void listBackupSummaries().then(rows => { if (active) setEntries(rows); }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Liste des sauvegardes inaccessible."); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [open]);
  const action = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await operation(); }
    catch (e) { setError(e instanceof Error ? e.message : "Opération impossible. Aucun nettoyage autorisé."); }
    finally { setBusy(false); }
  };
  const choose = (id: string) => void action(async () => { const saved = await readBackup(id); setSnapshot(saved); setSelected(id); setVerified(""); setMessage("Sauvegarde relue. Cliquez sur Vérifier la restauration pour tester cette copie."); });
  const restore = () => void action(async () => {
    if (!snapshot) return;
    const state = readPaperState();
    if (state.running || state.position || state.pending) throw new Error("Restauration refusée pendant une simulation Paper active ou avec une position/entrée en attente. Les sorties existantes restent intactes.");
    if (!window.confirm("Restaurer les configurations enregistrées et les bougies MT5 de cette sauvegarde ? Le registre Paper ne sera pas écrasé ; aucun test ni ordre ne sera lancé. Une sauvegarde de l’état actuel sera d’abord créée.")) return;
    const target = await testRestoration(snapshot.id);
    await create();
    if (!navigator.locks) throw new Error("Verrouillage entre onglets indisponible : restauration des paramètres refusée par sécurité.");
    const count = await navigator.locks.request("tradebot-paper-real-v1", { mode: "exclusive" }, () => {
      const current = readPaperState();
      if (current.running || current.position || current.pending) throw new Error("La simulation est devenue active entre-temps. Restauration annulée sans modifier les paramètres.");
      const restoredCount = restoreConfigurations(target);
      if (target.mt5) updateMT5DataSession({ history: target.mt5, ...target.connection, status: null });
      return restoredCount;
    });
    setSnapshot(target); setSelected(target.id); setVerified(target.id);
    setMessage(`${count} configuration(s) restaurée(s), ${target.mt5 ? `${target.mt5.candles.length} bougies MT5 restaurées` : "aucune bougie MT5 disponible"}. Les écrans de configuration déjà ouverts doivent être rouverts pour lire ces valeurs. Les résultats et archives restent consultables/exportables dans cette sauvegarde ; le journal Paper actif n’est pas écrasé. Connexion MT5 actuelle : Non disponible jusqu’à une nouvelle détection.`);
    console.info("[TradeBot Backup] Restauration explicite terminée", { id: target.id, configurations: count, mt5Candles: target.mt5?.candles.length ?? 0 });
  });
  const resultCount = (kind: string) => snapshot?.results.filter(r => r.kind === kind).length ?? 0;
  return <>
    <Button onClick={() => setOpen(true)} variant="outline" className="min-h-12 rounded-xl border-primary/40 bg-card"><Archive className="mr-2 h-4 w-4 text-primary" />Ouvrir les sauvegardes</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto rounded-3xl border-primary/30 bg-card p-5 sm:p-7">
        <DialogHeader><DialogTitle className="flex items-center gap-3 text-xl"><ShieldCheck className="h-6 w-6 text-primary" />Sauvegardes conservées</DialogTitle></DialogHeader>
        <p className="text-sm leading-relaxed text-muted-foreground">Aucune copie n’est créée automatiquement. La liste est lue à l’ouverture ; le contenu d’une copie n’est chargé que lorsque vous la sélectionnez. Les sauvegardes et exports explicites conservent les données accessibles sans relancer les moteurs.</p>
        <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">Ne rafraîchissez pas Preview avant la sauvegarde. Exportez le JSON sur votre ordinateur : le stockage du navigateur survit à une fermeture, mais pas à un effacement du cache ou des données du site.</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} className="min-h-11 rounded-xl" onClick={() => void action(async () => { await create(); })}>Sauvegarder et vérifier maintenant</Button>
          <Button variant="outline" disabled={busy || !snapshot} className="min-h-11 rounded-xl" onClick={() => snapshot && downloadBackup(snapshot)}><Download className="mr-2 h-4 w-4" />Exporter le JSON</Button>
          <Button variant="outline" disabled={busy} className="min-h-11 rounded-xl" onClick={() => void action(async () => {
            if (!navigator.locks) throw new Error("Verrouillage du navigateur indisponible : export complet refusé.");
            await navigator.locks.request("tradebot-paper-real-v1", { mode: "exclusive" }, async () => {
              const current = readPaperState();
              if (current.running || current.position || current.pending) throw new Error("Arrêtez les anciennes simulations et attendez leurs sorties virtuelles avant l’export complet. Aucun trade n’est fermé par cette sauvegarde.");
              await exportFullBrowserBackup({ m1: session, m5: m5Session });
            });
            setMessage("Les bases de backtests et sauvegardes, les configurations et les sessions accessibles ont été exportées après restauration de copie vérifiée. Sélectionnez ce fichier dans sauvegarder_tradebot.bat pour créer la copie externe des sources et du registre FTMO Windows. Cette archive externe n’est pas encore créée ni vérifiée ici.");
          })}><Download className="mr-2 h-4 w-4" />Exporter toutes les données du navigateur</Button>
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-border px-4 text-sm hover:bg-secondary"><Upload className="mr-2 h-4 w-4" />Importer une sauvegarde<input type="file" accept="application/json,.json" disabled={busy} className="sr-only" onChange={e => {
            const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
            void action(async () => {
              if (file.size > 50 * 1024 * 1024) throw new Error("Fichier trop volumineux : plafond 50 Mo.");
              const imported = backupSchema.parse(decodeBackup(await file.text()));
              const saved = await saveBackup({ ...imported, id: crypto.randomUUID() });
              await testRestoration(saved.id); setSnapshot(saved); setSelected(saved.id); setVerified(saved.id); setEntries(await listBackupSummaries());
              setMessage("Fichier importé, enregistré et restauration de copie vérifiée. Aucun paramètre actif n’a été écrasé.");
            });
          }} /></label>
        </div>
        {entries.length > 0 && <label className="space-y-2 text-sm"><span className="block font-semibold">Copies conservées ({entries.length})</span><select disabled={busy} value={selected} onChange={e => { if (e.target.value) choose(e.target.value); }} className="h-11 w-full rounded-xl border border-input bg-background px-3"><option value="">Choisir une copie à charger</option>{entries.map(entry => <option key={entry.id} value={entry.id}>{new Date(entry.createdAt).toLocaleString("fr-FR")} · {entry.id.slice(0, 8)}</option>)}</select></label>}
        {snapshot && <>
          <dl className="grid gap-3 rounded-2xl border border-border bg-background/40 p-4 sm:grid-cols-2">{[
            ["Configuration H1 enregistrée", snapshot.storage.some(e => e.key === STRATEGY_STORAGE_KEY) ? "Incluse (valeur brute intacte)" : "Non disponible"],
            ["Configuration Scalping enregistrée", snapshot.storage.some(e => e.key === SCALPING_KEY) ? "Incluse (valeur brute intacte)" : "Non disponible"],
            ["Bougies MT5", snapshot.mt5 ? `${snapshot.mt5.candles.length} · ${snapshot.mt5.symbol}` : "Non disponible"],
            ["Backtests H1 accessibles", resultCount("backtest-h1") || "Non disponible"],
            ["Backtests Scalping accessibles", resultCount("backtest-scalping") || "Non disponible"],
            ["Rapports d’optimisation accessibles", resultCount("optimization") || "Non disponible"],
            ["Registres et clés locales", `${snapshot.storage.length} entrée(s), archives incluses si présentes`],
            ["Restauration de copie", verified === snapshot.id ? "Vérifiée à l’identique" : "À vérifier"],
          ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-medium">{value}</dd></div>)}</dl>
          <div className="flex flex-wrap gap-2"><Button variant="outline" className="min-h-11 rounded-xl" disabled={busy} onClick={() => void action(async () => { await testRestoration(snapshot.id); setVerified(snapshot.id); setMessage("Copie temporaire restaurée depuis le stockage durable et comparée intégralement : identique. Aucune stratégie ni aucun registre actif modifié."); })}>Vérifier la restauration</Button><Button variant="outline" className="min-h-11 rounded-xl" disabled={busy} onClick={restore}>Restaurer MT5 et configurations</Button></div>
          <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-semibold text-primary">Inventaire des résultats sauvegardés</summary><ul className="mt-3 space-y-2 text-xs">{snapshot.results.map((result, i) => <li key={i}>{result.label} · capturé le {new Date(result.capturedAt).toLocaleString("fr-FR")} · données complètes incluses dans le JSON</li>)}{!snapshot.results.length && <li>Non disponible. Aucun résultat fictif ou recalculé n’a été ajouté.</li>}</ul></details>
          <details className="rounded-xl border border-border p-3" open><summary className="cursor-pointer text-sm font-semibold">Ce qui n’est pas certifié sauvegardé</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-xs leading-relaxed text-muted-foreground">{snapshot.limitations.map(line => <li key={line}>{line}</li>)}</ul></details>
        </>}
        {busy && <p role="status" className="text-sm text-primary">Écriture, relecture et vérification en cours…</p>}
        {message && <p role="status" className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">{message}</p>}
        {error && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">{error} Ne procédez pas au nettoyage.</p>}
      </DialogContent>
    </Dialog>
  </>;
}
