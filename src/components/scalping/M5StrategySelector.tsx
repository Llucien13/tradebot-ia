import { useState } from "react";
import { ScalpingM5Panel } from "./ScalpingM5Panel";
import { M5V3OneClick } from "./M5V3OneClick";

export function M5StrategySelector() {
  const [strategy, setStrategy] = useState("v3");
  return <div className="space-y-5"><details className="rounded-2xl border border-border bg-card p-4"><summary className="cursor-pointer text-sm font-semibold">Autres moteurs M5 · historique et comparaison</summary><label className="mt-3 block space-y-2 text-sm">Stratégie PAPER<select className="h-12 w-full rounded-xl border border-input bg-background px-3" value={strategy} onChange={e => setStrategy(e.target.value)}><option value="v3">M5 V3 — Rebond Price Action</option><option value="existing">M5 corrigé V2 · continuité des séances (V1 disponible pour comparaison)</option></select></label></details>{strategy === "v3" ? <M5V3OneClick /> : <ScalpingM5Panel />}</div>;
}
