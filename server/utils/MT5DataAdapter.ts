import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { win32 } from "node:path";
import { createError } from "nitro/h3";
import { z } from "zod";
import { mt5ConnectionSchema, mt5HistoryRequestSchema, mt5HistorySchema, mt5StatusSchema, type MT5Connection, type MT5Timeframe, minutesPerBar, barsIn7Days } from "../../src/lib/mt5-data";
import { MT5_READER } from "./mt5-python";

let active = false;
const pythonSchema = z.object({ executable: z.string().min(1), version: z.string(), bits: z.literal(64), venv: z.boolean() });
const PROBE = "import sys,json,struct; print(json.dumps({'executable':sys.executable,'version':sys.version.split()[0],'bits':struct.calcsize('P')*8,'venv':sys.prefix!=sys.base_prefix}))";

interface OperationRecord {
  controller: AbortController;
  progress: number;
  completed: boolean;
}

const operations = new Map<string, OperationRecord>();

function run(command: string, args: string[], input: string, timeout: number, signal?: AbortSignal, onProgress?: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(abortTimer);
      if (child) {
        try { child.kill(); } catch { /* ignore */ }
      }
      if (error) reject(error); else resolve(stdout);
    };
    const timer = setTimeout(() => finish(new Error("Le pont Python MT5 a dépassé le délai autorisé. Aucun ordre n'a été envoyé.")), timeout);
    const abortTimer = setInterval(() => {
      if (signal?.aborted) {
        finish(new Error("L'opération a été annulée. Aucune donnée n'a été conservée."));
      }
    }, 200);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
    });
    child.stderr.on("data", chunk => {
      stderr = (stderr + chunk.toString()).slice(-16000);
      for (const match of stderr.matchAll(/PROGRESS\s+(\d+)\n/g)) {
        onProgress?.(Number(match[1]));
      }
    });
    child.on("error", () => finish(new Error("Exécutable Python introuvable ou inaccessible.")));
    child.on("close", code => finish(code === 0 ? undefined : new Error(`Le pont Python a échoué : ${stderr.trim().slice(-2000) || `code ${code}`}`)));
    child.stdin.on("error", () => { /* A process error or exit supplies the diagnostic. */ });
    child.stdin.end(input);
  });
}

export class MT5DataAdapter {
  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (process.platform !== "win32") throw createError({ statusCode: 503, statusMessage: "L'intégration officielle MT5 requiert Windows 64 bits, Python 64 bits et le terminal sur le même PC que ce serveur local. Un serveur distant, Linux ou macOS ne peut pas accéder directement à votre terminal Windows." });
    if (active) throw createError({ statusCode: 409, statusMessage: "Une opération du pont MT5 est déjà en cours. Aucun appel supplémentaire n'est lancé ; attendez sa fin." });
    active = true;
    try { return await operation(); }
    finally { active = false; }
  }
  private async python() {
    const choices = [{ command: "py", args: ["-3.12"] }, { command: "py", args: ["-3"] }, { command: "python", args: [] }, { command: "python3", args: [] }];
    for (const choice of choices) {
      try {
        const result = pythonSchema.safeParse(JSON.parse(await run(choice.command, [...choice.args, "-c", PROBE], "", 8000)));
        if (result.success && win32.isAbsolute(result.data.executable)) return result.data;
      } catch { /* Try the next standard local Python launcher, not an arbitrary executable. */ }
    }
    throw createError({ statusCode: 503, statusMessage: "Python 64 bits non détecté. Installez Python 3.12 Windows 64 bits depuis python.org avec le lanceur Python et l'option Add Python to PATH. Si Python vient d'être installé, rouvrez Dyad pour actualiser son environnement." });
  }
  private async terminal(connection: MT5Connection) {
    const path = connection.terminalPath?.trim() ?? "";
    if (path) {
      if (!win32.isAbsolute(path) || win32.basename(path).toLowerCase() !== "terminal64.exe") throw createError({ statusCode: 400, statusMessage: "Indiquez un chemin Windows absolu vers le véritable terminal64.exe de MetaTrader 5, ou laissez le champ vide pour la détection officielle." });
      try { if (!(await stat(path)).isFile()) throw new Error(); }
      catch { throw createError({ statusCode: 400, statusMessage: "Le terminal64.exe indiqué n'existe pas ou n'est pas accessible sur ce PC." }); }
    }
    return path;
  }
  private async read(action: "status" | "history", request: Record<string, unknown>, connection: MT5Connection, signal?: AbortSignal, token?: string) {
    const record = token ? operations.get(token) : undefined;
    const controller = record?.controller ?? new AbortController();
    if (signal?.aborted) controller.abort();
    if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });
    const python = await this.python();
    const terminalPath = await this.terminal(connection);
    if (controller.signal.aborted) throw new Error("Opération MT5 annulée.");
    try {
      const output = await run(python.executable, ["-c", MT5_READER], JSON.stringify({ ...request, action, terminalPath }), 600000, controller.signal, (pct) => { if (record) record.progress = Math.max(record.progress, Math.min(99, pct)); });
      let body: unknown;
      try { body = JSON.parse(output); } catch { throw createError({ statusCode: 502, statusMessage: "Réponse Python MT5 illisible. Aucun historique de remplacement n'est généré." }); }
      const envelope = z.object({ ok: z.boolean(), message: z.string().optional(), data: z.unknown().optional() }).parse(body);
      if (!envelope.ok) throw createError({ statusCode: 503, statusMessage: (envelope.message ?? "Lecture MT5 impossible.").slice(0, 1500) });
      if (record) record.progress = 99;
      return envelope.data;
    } catch (e) {
      throw e;
    }
  }
  inspect(input: unknown, signal?: AbortSignal) {
    const connection = mt5ConnectionSchema.parse(input);
    return this.exclusive(async () => mt5StatusSchema.parse(await this.read("status", {}, connection, signal)));
  }
  fetchRange(input: unknown) {
    const request = mt5HistoryRequestSchema.parse(input);
    const tf: MT5Timeframe = request.timeframe;
    const barMs = minutesPerBar[tf] * 60000;
    const startMs = Date.parse(request.start), endMs = Date.parse(request.end), warmup = request.warmup;
    if (startMs < Date.UTC(1970, 0, 2) || startMs >= endMs || endMs > Date.now() || startMs % barMs || endMs % barMs) throw createError({ statusCode: 400, statusMessage: `Plage MT5 passée requise, bornes UTC alignées à la barre ${tf} et fin exclusive après le début.` });
    const maxWarmup = barsIn7Days[tf] - 2;
    if (warmup > maxWarmup) throw createError({ statusCode: 422, statusMessage: `Préchauffage maximum pour ${tf} : ${maxWarmup} bougies (7 jours d'historique). Réduisez le préchauffage.` });
    const token = request.token;
    if (operations.has(token)) throw createError({ statusCode: 409, statusMessage: "Token MT5 déjà utilisé." });
    const record: OperationRecord = { controller: new AbortController(), progress: 0, completed: false };
    operations.set(token, record);
    return this.exclusive(async () => {
      const rawData = await this.read("history", { ...request, startMs, endMs }, request, undefined, token);
      const data = mt5HistorySchema.parse(rawData);
      if (data.interval !== ({ M1: "1m", M5: "5m", M15: "15m" } as const)[tf] || !data.candles.every((c, i) => c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) && c.high >= c.low && c.time % barMs === 0 && (!i || c.time > data.candles[i - 1].time))) throw createError({ statusCode: 502, statusMessage: "Historique MT5 incohérent, lecture refusée." });
      if (record.controller.signal.aborted) throw new Error("Opération MT5 annulée.");
      record.progress = 100;
      return data;
    }).finally(() => {
      record.completed = true;
      setTimeout(() => operations.delete(token), 60000);
    });
  }
  installOfficialPackage() {
    return this.exclusive(async () => {
      const python = await this.python();
      const args = ["-m", "pip", "--isolated", "install", "--disable-pip-version-check", "--only-binary=:all:", "--index-url", "https://pypi.org/simple", ...(python.venv ? [] : ["--user"]), "MetaTrader5"];
      try { await run(python.executable, args, "", 180000); }
      catch (e) { throw createError({ statusCode: 503, statusMessage: `Installation officielle impossible : ${e instanceof Error ? e.message : "erreur Python"}`.slice(0, 2000) }); }
      return { ok: true, message: "Package officiel MetaTrader5 installé ou déjà présent dans Python. Ouvrez le terminal et cliquez sur Détecter MT5 & Gold. Aucun terminal n'a été connecté et aucun ordre n'a été envoyé par cette installation.", pythonVersion: python.version };
    });
  }
  getOperation(token: string) {
    const op = operations.get(token);
    return { progress: op?.progress ?? 0, completed: op?.completed ?? false };
  }
  cancelOperation(token: string) {
    const op = operations.get(token);
    if (!op || op.completed) return false;
    op.controller.abort();
    return true;
  }
}
export const mt5DataAdapter = new MT5DataAdapter();