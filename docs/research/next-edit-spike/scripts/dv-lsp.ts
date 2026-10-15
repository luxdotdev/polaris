// A minimal LSP client over stdio for the diagnostics-verifier measurements (2026-10-15):
// open a document, replace its text, and pull diagnostics for it.
import type { Subprocess } from "bun";

export type Diag = { line: number; character: number; endLine: number; endCharacter: number; code: string; severity: number; message: string };

export class Lsp {
  private proc: Subprocess<"pipe", "pipe", "pipe">;
  private id = 0;
  private pending = new Map<number, (v: { result?: unknown; error?: unknown }) => void>();
  private buffer = new Uint8Array(0);
  private versions = new Map<string, number>();
  readonly pushed = new Map<string, { version?: number; diagnostics: unknown[] }>();
  private waiters: { uri: string; resolve: (d: Diag[]) => void }[] = [];

  constructor(argv: string[], cwd: string) {
    this.proc = Bun.spawn(argv, { cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    void this.read();
  }

  private async read() {
    for await (const chunk of this.proc.stdout) {
      const merged = new Uint8Array(this.buffer.length + chunk.length);
      merged.set(this.buffer);
      merged.set(chunk, this.buffer.length);
      this.buffer = merged;
      for (;;) {
        const text = new TextDecoder().decode(this.buffer.slice(0, Math.min(this.buffer.length, 200)));
        const end = text.indexOf("\r\n\r\n");
        if (end < 0) break;
        const length = Number(/Content-Length: (\d+)/i.exec(text.slice(0, end))?.[1]);
        const start = new TextEncoder().encode(text.slice(0, end + 4)).length;
        if (this.buffer.length < start + length) break;
        const body = JSON.parse(new TextDecoder().decode(this.buffer.slice(start, start + length)));
        this.buffer = this.buffer.slice(start + length);
        this.dispatch(body);
      }
    }
  }

  private dispatch(msg: { id?: number; method?: string; params?: any; result?: unknown; error?: unknown }) {
    if (msg.method && msg.id !== undefined) {
      // Server-to-client requests (configuration, registration, progress): answer null or defaults.
      const result = msg.method === "workspace/configuration" ? (msg.params?.items ?? []).map(() => null) : null;
      this.send({ jsonrpc: "2.0", id: msg.id, result });
    } else if (msg.method === "textDocument/publishDiagnostics") {
      this.pushed.set(msg.params.uri, msg.params);
      const waiting = this.waiters.splice(0);
      for (const w of waiting) if (w.uri === msg.params.uri) w.resolve(msg.params.diagnostics.map(toDiag));
      else this.waiters.push(w);
    }
    else if (msg.id !== undefined) this.pending.get(msg.id)?.(msg), this.pending.delete(msg.id);
  }

  private send(msg: unknown) {
    const body = JSON.stringify(msg);
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    void this.proc.stdin.flush();
  }

  request<T>(method: string, params: unknown, timeoutMs = 60_000): Promise<T> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => (this.pending.delete(id), reject(new Error(`${method} timed out`))), timeoutMs);
      this.pending.set(id, (m) => (clearTimeout(timer), m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result as T)));
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  async initialize(root: string, initializationOptions: unknown = {}) {
    await this.request("initialize", {
      processId: process.pid, rootUri: `file://${root}`, workspaceFolders: [{ uri: `file://${root}`, name: "root" }], initializationOptions,
      capabilities: { textDocument: { diagnostic: { dynamicRegistration: false }, publishDiagnostics: { versionSupport: true }, synchronization: { didSave: false } },
        workspace: { configuration: true, workspaceFolders: true } },
    }, 180_000);
    this.notify("initialized", {});
  }

  open(uri: string, text: string) {
    this.versions.set(uri, 1);
    const languageId = uri.endsWith(".tsx") ? "typescriptreact" : "typescript";
    this.notify("textDocument/didOpen", { textDocument: { uri, languageId, version: 1, text } });
  }

  change(uri: string, text: string) {
    const version = (this.versions.get(uri) ?? 1) + 1;
    this.versions.set(uri, version);
    this.notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text }] });
    return version;
  }

  close(uri: string) {
    this.notify("textDocument/didClose", { textDocument: { uri } });
    this.versions.delete(uri);
  }

  version(uri: string) {
    return this.versions.get(uri) ?? 0;
  }

  async pull(uri: string, timeoutMs = 120_000): Promise<Diag[]> {
    const r = await this.request<{ items?: any[] }>("textDocument/diagnostic", { textDocument: { uri } }, timeoutMs);
    return (r.items ?? []).map(toDiag);
  }

  /** The next pushed diagnostics for the document (servers without pull, like typescript-language-server). */
  nextPush(uri: string, timeoutMs = 30_000): Promise<Diag[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no diagnostics pushed")), timeoutMs);
      this.waiters.push({ uri, resolve: (d) => (clearTimeout(timer), resolve(d)) });
    });
  }

  async stop() {
    await this.request("shutdown", null, 10_000).catch(() => undefined);
    this.notify("exit", null);
    setTimeout(() => this.proc.kill(), 2000);
    await this.proc.exited;
  }
}

export const toDiag = (d: any): Diag => ({
  line: d.range.start.line, character: d.range.start.character, endLine: d.range.end.line, endCharacter: d.range.end.character,
  code: String(d.code ?? ""), severity: d.severity ?? 1, message: typeof d.message === "string" ? d.message : JSON.stringify(d.message),
});
