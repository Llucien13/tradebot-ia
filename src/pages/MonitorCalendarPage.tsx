import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMonitor } from "@/components/monitor/MonitorLayout";
import { date, money, number, Panel, tone } from "@/components/monitor/MonitorCards";
import { readJournal, type JournalData } from "@/lib/paper-monitor-api";
import { calendarGrid, parisDateKey, parisMidnightEpoch, shiftCalendarDay, summarizeCalendarTrades, type CalendarTrade } from "@/lib/paper-calendar";

const PAGE_SIZE = 100;
const monthFormatter = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", month: "long", year: "numeric" });

function currentMonthKey() {
  return parisDateKey(Date.now() / 1000).slice(0, 7);
}

function changeMonth(monthKey: string, offset: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(monthKey: string) {
  return monthFormatter.format(new Date(`${monthKey}-15T12:00:00Z`));
}

async function loadClosedTrades(monthKey: string, signal: AbortSignal): Promise<CalendarTrade[]> {
  const grid = calendarGrid(monthKey);
  const params = new URLSearchParams({ result: "all", start: String(parisMidnightEpoch(grid.start)), end: String(parisMidnightEpoch(shiftCalendarDay(grid.end, 1))) });
  const items: JournalData["items"] = [];
  let offset = 0;
  let total = 0;
  do {
    params.set("offset", String(offset));
    params.set("limit", String(PAGE_SIZE));
    const page = await readJournal(params, signal);
    total = page.total;
    items.push(...page.items);
    if (!page.items.length) break;
    offset += page.items.length;
    if (offset >= 1_000_000 && offset < total) throw new Error("Le journal dépasse la limite de lecture paginée du bridge.");
  } while (offset < total);
  return items.filter(item => Number.isFinite(item.trade.exitTime)) as CalendarTrade[];
}

function dayState(pnl: number | null | undefined) {
  if (pnl == null || pnl === 0) return "border-slate-700 bg-slate-900/70 text-slate-200";
  return pnl > 0 ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-rose-500/30 bg-rose-500/10 text-rose-200";
}

export default function MonitorCalendarPage() {
  const { data } = useMonitor();
  const [month, setMonth] = useState(currentMonthKey);
  const [selectedDay, setSelectedDay] = useState(() => parisDateKey(Date.now() / 1000));
  useEffect(() => {
    if (!selectedDay.startsWith(month)) setSelectedDay(`${month}-01`);
  }, [month, selectedDay]);
  const grid = calendarGrid(month);
  const query = useQuery({
    queryKey: ["paper-calendar", month],
    queryFn: ({ signal }) => loadClosedTrades(month, signal),
    enabled: !!data,
    refetchInterval: 12000,
    retry: false,
  });
  const summary = summarizeCalendarTrades(query.data ?? [], grid.start, grid.end);
  const monthDays = Object.entries(summary.days).filter(([day]) => day.startsWith(`${month}-`)).map(([, value]) => value);
  const monthCount = monthDays.reduce((sum, day) => sum + day.count, 0);
  const monthPnl = monthDays.every(day => day.pnl !== null) ? monthDays.reduce((sum, day) => sum + (day.pnl ?? 0), 0) : null;
  const selected = summary.days[selectedDay];
  const dayLabels = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

  return <div className="space-y-6">
    <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Journal clôturé · Europe/Paris</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Calendrier PAPER</h1><p className="mt-3 text-sm leading-relaxed text-slate-400">Source : registre PAPER V86 · P&L net à la date réelle de clôture · aucune donnée de démonstration.</p></div>
    {!data && <p role="status" className="rounded-2xl border border-slate-700 bg-slate-900 p-4 text-sm text-slate-300">Calendrier indisponible tant que le registre PAPER local n’est pas confirmé.</p>}
    {query.isError && <p role="alert" className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-100">{query.error.message}</p>}
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><p className="text-xs text-slate-400">Résultat du mois · PAPER</p><p className={`mt-3 text-2xl font-semibold tabular-nums ${tone(monthPnl)}`}>{money(monthPnl)}</p><p className="mt-2 text-xs text-slate-400">{monthCount} trade(s) clôturé(s)</p></div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><p className="text-xs text-slate-400">Période</p><p className="mt-3 text-lg font-semibold capitalize">{formatMonth(month)}</p><p className="mt-2 text-xs text-slate-400">Clôtures horodatées Europe/Paris</p></div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><p className="text-xs text-slate-400">Sources affichées</p><p className="mt-3 text-lg font-semibold">PAPER V86</p><p className="mt-2 text-xs text-slate-400">Aucune source MT5 de journal disponible dans ce registre.</p></div>
    </div>
    <Panel title="Résultats quotidiens" aside={<div className="flex items-center gap-2"><Button variant="outline" size="icon" aria-label="Mois précédent" title="Mois précédent" className="h-10 w-10 border-slate-700 bg-transparent" onClick={() => setMonth(value => changeMonth(value, -1))}><ChevronLeft size={17} /></Button><span className="min-w-32 text-center text-sm font-medium capitalize">{formatMonth(month)}</span><Button variant="outline" size="icon" aria-label="Mois suivant" title="Mois suivant" className="h-10 w-10 border-slate-700 bg-transparent" disabled={month >= currentMonthKey()} onClick={() => setMonth(value => changeMonth(value, 1))}><ChevronRight size={17} /></Button></div>}>
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2" aria-label={`Calendrier PAPER ${formatMonth(month)}`}>
        {dayLabels.map(label => <div key={label} className="pb-1 text-center text-[10px] font-semibold uppercase text-slate-400 sm:text-xs">{label}</div>)}
        {grid.days.map(day => {
          const value = summary.days[day];
          const inMonth = day.startsWith(`${month}-`);
          return <button key={day} type="button" onClick={() => setSelectedDay(day)} aria-pressed={selectedDay === day} aria-label={`${day} : ${value?.count ?? 0} trades, ${value ? money(value.pnl) : "aucun trade"}`} className={`min-h-[76px] min-w-0 rounded-lg border p-1.5 text-left transition-colors sm:min-h-24 sm:p-2 ${dayState(value?.pnl)} ${inMonth ? "" : "opacity-45"} ${selectedDay === day ? "ring-2 ring-cyan-300 ring-offset-1 ring-offset-slate-900" : "hover:border-slate-500"}`}>
            <span className="block text-xs font-medium tabular-nums">{Number(day.slice(-2))}</span>
            {value && <><span className="mt-2 block truncate text-[10px] font-semibold tabular-nums sm:text-xs">{money(value.pnl)}</span><span className="mt-1 block text-[9px] text-slate-400 sm:text-[10px]">{value.count} trade(s)</span></>}
          </button>;
        })}
      </div>
      {query.isPending && <p role="status" className="mt-4 text-sm text-slate-400">Lecture du journal PAPER…</p>}
      {!query.isPending && !query.isError && !query.data?.length && <p className="mt-4 text-sm text-slate-400">Aucune clôture PAPER enregistrée pour cette période.</p>}
    </Panel>
    <Panel title="Totaux par semaine · lundi à dimanche">
      <div className="divide-y divide-slate-800">{grid.weeks.map(week => {
        const weekStart = week[0];
        const weekEnd = week[6];
        const value = summary.weeks[weekStart];
        return <div key={weekStart} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"><p className="text-sm text-slate-300">{weekStart} → {weekEnd}</p><p className="text-right text-xs text-slate-400">{value?.count ?? 0} trade(s) <span className={`ml-3 text-sm font-semibold tabular-nums ${tone(value?.pnl)}`}>{money(value ? value.pnl : 0)}</span></p></div>;
      })}</div>
    </Panel>
    <Panel title={`Détail des clôtures · ${selectedDay} · PAPER`}>
      {!selected?.trades.length ? <p className="text-sm text-slate-400">Aucun trade clôturé ce jour dans le registre.</p> : <ol className="divide-y divide-slate-800">{selected.trades.map(item => {
        const trade = item.trade;
        return <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-4 first:pt-0 last:pb-0"><div className="min-w-0"><p className="text-sm font-medium">XAUUSD <span className={trade.side === 1 ? "text-emerald-300" : "text-rose-300"}>{trade.side === 1 ? "ACHAT" : "VENTE"}</span><span className="ml-2 text-xs text-slate-400">{date(trade.exitTime)}</span></p><p className="mt-1 break-all font-mono text-[10px] text-slate-500">{item.id}</p><p className="mt-2 text-xs text-slate-400">{number(trade.entry)} → {number(trade.exit)} · {number(trade.lots, " lots")}{trade.reason ? ` · ${trade.reason}` : ""}</p></div><p className={`shrink-0 text-right text-sm font-semibold tabular-nums ${tone(trade.pnl)}`}>{money(trade.pnl)}</p></li>;
      })}</ol>}
    </Panel>
  </div>;
}