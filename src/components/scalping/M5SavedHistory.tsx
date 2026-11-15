import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { listBackups, readBackup } from "@/lib/backup";
import { updateMT5DataSession } from "@/lib/mt5-data-session";
import type { MT5History } from "@/lib/mt5-data";

export function M5SavedHistory() {
  const [entries, setEntries] = useState<{id:string;label:string}[]>([]), [selected,setSelected] = useState(""), [message,setMessage] = useState("");
  const load = async () => {
    try {
      const options: {id:string;label:string}[]=[];
      const seen = new Set<string>();
      for (const entry of await listBackups()) {
        const saved = await readBackup(entry.id);
        if (saved.mt5?.interval !== "5m") continue;
        const key = `${saved.mt5.symbol}:${saved.mt5.coverage.requestedStart}:${saved.mt5.coverage.requestedEnd}:${saved.mt5.fetchedAt}`;
        if (seen.has(key)) continue; seen.add(key);
        options.push({id:entry.id,label:`${saved.mt5.symbol} · ${new Date(saved.mt5.coverage.requestedStart).toLocaleDateString("fr-FR")} → ${new Date(saved.mt5.coverage.requestedEnd).toLocaleDateString("fr-FR")} · ${saved.mt5.candles.length} bougies M5`});
      }
      setEntries(options);
    } catch { setMessage("Les sauvegardes historiques sont inaccessibles ; aucune donnée inventée."); }
  };
  useEffect(() => { void load(); }, []);
  return <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer text-sm font-semibold">Réutiliser un historique M5 conservé</summary><div className="mt-4 space-y-3"><Button variant="outline" className="min-h-11 rounded-xl" onClick={() => void load()}>Rechercher dans les sauvegardes</Button><select value={selected} onChange={e => setSelected(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3"><option value="">Choisir un lot M5 déjà sauvegardé</option>{entries.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}</select><Button disabled={!selected} className="min-h-12 rounded-xl" onClick={async () => { try { const saved = await readBackup(selected); if (saved.mt5?.interval !== "5m") throw new Error(); updateMT5DataSession({history:saved.mt5 as MT5History,...saved.connection,status:null},"M5"); setMessage("Lot M5 restauré en mémoire sans connexion, requête M1 ni backtest. Détection MT5 nécessaire uniquement pour charger un autre lot."); } catch { setMessage("Lot inaccessible ; les données actuelles restent conservées."); } }}>Utiliser ce lot M5 sans téléchargement</Button>{!entries.length && <p className="text-xs text-muted-foreground">Aucune sauvegarde M5 accessible. Les lots non sauvegardés avant fermeture ne peuvent pas être récupérés.</p>}{message && <p role="status" className="text-xs">{message}</p>}</div></details>;
}
