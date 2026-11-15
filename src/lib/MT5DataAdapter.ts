import { z } from "zod";
import { mt5StatusSchema, mt5HistorySchema, mt5HistoryRequestSchema, type MT5Connection, type MT5History, type MT5Status } from "./mt5-data";

// Browser adapter: all Python and terminal access stays on the local server.
export class MT5DataAdapter {
  private async call<T>(path: string, body: unknown, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), signal, cache: "no-store" });
    let data: unknown;
    try { data = await response.json(); } catch { throw new Error("Le serveur local MT5 ne renvoie pas de JSON valide."); }
    if (!response.ok) {
      const failure = z.object({ statusMessage: z.string().optional(), message: z.string().optional() }).safeParse(data);
      throw new Error(failure.success ? failure.data.statusMessage || failure.data.message || "Lecture MT5 impossible." : "Lecture MT5 impossible.");
    }
    const result = schema.safeParse(data);
    if (!result.success) throw new Error("Données MT5 invalides : aucune bougie de remplacement n’est générée.");
    return result.data;
  }
  inspect(connection: MT5Connection, signal?: AbortSignal): Promise<MT5Status> {
    return this.call("/api/mt5/status", connection, mt5StatusSchema, signal);
  }
  fetchRange(request: z.infer<typeof mt5HistoryRequestSchema>, signal?: AbortSignal): Promise<MT5History> {
    return this.call("/api/mt5/history", request, mt5HistorySchema, signal);
  }
  async progress(token: string, signal?: AbortSignal) {
    const response = await fetch(`/api/mt5/progress?token=${encodeURIComponent(token)}`, { headers: { "Content-Type": "application/json", Accept: "application/json" }, signal, cache: "no-store" });
    if (!response.ok) throw new Error("Progression MT5 indisponible.");
    return z.object({ progress: z.number().min(0).max(100), completed: z.boolean() }).parse(await response.json());
  }
  cancel(token: string) {
    return this.call("/api/mt5/cancel", { token }, z.object({ cancelled: z.boolean() }));
  }
  installOfficialPackage(signal?: AbortSignal) {
    return this.call("/api/mt5/setup", { confirm: true }, z.object({ ok: z.literal(true), message: z.string(), pythonVersion: z.string() }), signal);
  }
}
