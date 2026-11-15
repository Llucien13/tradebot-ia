import { ArrowUpRight, PanelsTopLeft } from "lucide-react";
import { Link } from "react-router-dom";

export default function TradingSeparationNotice() {
  return <Link to="/positions" className="flex min-w-0 flex-wrap items-center justify-between gap-4 rounded-2xl border border-cyan-400/20 bg-slate-900/70 p-5 transition-colors hover:border-cyan-300/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"><div className="flex min-w-0 items-start gap-3"><PanelsTopLeft size={20} className="mt-0.5 shrink-0 text-cyan-300" /><div className="min-w-0"><p className="font-medium">Premium Control Desk <span className="ml-2 text-xs text-cyan-300">V87</span></p><p className="mt-2 text-sm leading-relaxed text-slate-400">Positions du bot et vos positions MT5, sans mélange. Le trading manuel reste directement dans MT5 sur PC ou iPhone.</p></div></div><ArrowUpRight size={18} className="shrink-0 text-cyan-300" aria-hidden="true" /></Link>;
}
