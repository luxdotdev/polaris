// A minimal stdio LSP client for the import study: requests, and settled publishDiagnostics.
import type { Subprocess } from "bun";

export interface Diagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  code?: number | string;
  message: string;
  [key: string]: unknown;
}

export class LspClient {
  private readonly proc: Subprocess<"pipe", "pipe", "inherit">;
  private id = 0;
  private readonly pending = new Map<number, (value: unknown) => void>();
  private readonly diagnostics = new Map<string, { at: number; items: Diagnostic[] }>();
  private buffer = new Uint8Array(0);

  constructor(command: string[], cwd: string) {
    this.proc = Bun.spawn(command, { cwd, stdin: "pipe", stdout: "pipe", stderr: "inherit" });
    void this.read();
  }

  private async read() {
    for await (const chunk of this.proc.stdout) {
      const next = new Uint8Array(this.buffer.length + chunk.length);
      next.set(this.buffer);
      next.set(chunk, this.buffer.length);
      this.buffer = next;
      for (;;) {
        const head = new TextDecoder().decode(this.buffer.slice(0, 200));
        const end = head.indexOf("\r\n\r\n");
        if (end === -1) break;
        const length = Number(/Content-Length: (\d+)/i.exec(head)?.[1]);
        const start = new TextEncoder().encode(head.slice(0, end + 4)).length;
        if (this.buffer.length < start + length) break;
        const message = JSON.parse(new TextDecoder().decode(this.buffer.slice(start, start + length)));
        this.buffer = this.buffer.slice(start + length);
        this.handle(message);
      }
    }
  }

  private handle(message: { id?: number; method?: string; params?: any; result?: unknown; error?: unknown }) {
    if (message.method === "textDocument/publishDiagnostics")
      this.diagnostics.set(message.params.uri, { at: performance.now(), items: message.params.diagnostics });
    else if (message.method && message.id !== undefined) this.send({ jsonrpc: "2.0", id: message.id, result: null });
    else if (message.id !== undefined) this.pending.get(message.id)?.(message.error ? { error: message.error } : message.result);
  }

  private send(message: unknown) {
    const body = JSON.stringify(message);
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    this.proc.stdin.flush();
  }

  request(method: string, params: unknown, timeoutMs = 120_000): Promise<any> {
    const id = ++this.id;
    this.send({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
      this.pending.set(id, (value) => { clearTimeout(timer); resolve(value); });
    });
  }

  notify(method: string, params: unknown) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  async initialize(root: string, initializationOptions: unknown) {
    await this.request("initialize", {
      processId: process.pid,
      rootUri: `file://${root}`,
      workspaceFolders: [{ uri: `file://${root}`, name: "polaris" }],
      initializationOptions,
      capabilities: {
        general: { positionEncodings: ["utf-16"] },
        workspace: { workspaceEdit: { documentChanges: true }, configuration: false },
        textDocument: {
          synchronization: { didSave: true },
          publishDiagnostics: { relatedInformation: false },
          codeAction: {
            codeActionLiteralSupport: { codeActionKind: { valueSet: ["quickfix", "refactor", "source"] } },
            isPreferredSupport: true,
            dataSupport: true,
            resolveSupport: { properties: ["edit"] },
          },
        },
      },
    });
    this.notify("initialized", {});
  }

  /** Opens the document and waits until its diagnostics stop changing. */
  async open(uri: string, languageId: string, text: string, quietMs = 4000, timeoutMs = 180_000) {
    this.notify("textDocument/didOpen", { textDocument: { uri, languageId, version: 1, text } });
    const start = performance.now();
    for (;;) {
      await Bun.sleep(250);
      const seen = this.diagnostics.get(uri);
      if (seen && performance.now() - seen.at > quietMs) return seen.items;
      if (performance.now() - start > timeoutMs) return seen?.items ?? [];
    }
  }

  private versions = new Map<string, number>();

  /** Replaces the document's text and waits for its diagnostics to settle again. */
  async change(uri: string, text: string, quietMs = 3000, timeoutMs = 120_000) {
    const version = (this.versions.get(uri) ?? 1) + 1;
    this.versions.set(uri, version);
    const before = this.diagnostics.get(uri)?.at ?? 0;
    this.notify("textDocument/didChange", { textDocument: { uri, version }, contentChanges: [{ text }] });
    const start = performance.now();
    for (;;) {
      await Bun.sleep(250);
      const seen = this.diagnostics.get(uri);
      if (seen && seen.at > before && performance.now() - seen.at > quietMs) return seen.items;
      if (performance.now() - start > timeoutMs) return seen?.items ?? [];
    }
  }

  async closeDocument(uri: string) {
    this.notify("textDocument/didClose", { textDocument: { uri } });
    this.diagnostics.delete(uri);
    this.versions.delete(uri);
    await Bun.sleep(500);
  }

  async close() {
    await this.request("shutdown", null, 10_000).catch(() => undefined);
    this.notify("exit", null);
    setTimeout(() => this.proc.kill(), 2000);
    await this.proc.exited;
  }
}
