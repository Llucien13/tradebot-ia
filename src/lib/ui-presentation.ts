// Display and local export only; never imported by an execution engine.
export const uiDateTime = (time: number | string) => new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(time)).replace(",", "") + " UTC";
export const uiDate = (time: number) => new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(time);
export type DisplayPeriod = "today" | "7" | "30" | "all";
export function periodStart(period: DisplayPeriod, now: number) {
  const date = new Date(now);
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return period === "all" ? 0 : period === "today" ? midnight : midnight - (Number(period) - 1) * 86400000;
}
export function exportCSV(filename: string, headers: string[], rows: (string | number | null)[][]) {
  const cell = (value: string | number | null) => {
    let text = value === null ? "" : String(value);
    if (typeof value === "string" && /^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const csv = "\uFEFF" + [headers, ...rows].map(row => row.map(cell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
