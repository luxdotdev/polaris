// dv-wired.ts <states.json> <tsls|tsgo> <verify|idle> [cases] [out.tsv]: the Editor's own verifier
// (renderer session, shadow, requests, verifyDiagnostics) on a real in-process Daemon and server,
// timed per recorded Final after a simulated keystroke and pause. Env: DV_NODE, DV_TSLS, DV_TSSERVER.
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Text } from "../../../../apps/desktop/node_modules/@codemirror/state/dist/index.js";
import * as P from "../../../../packages/protocol/src/index.ts";
import { Effect, Fiber, Redacted, Schema, Stream } from "effect";
import { connectRpc, socketTransport } from "../../../../packages/client/src/index.ts";
import { EventStore } from "../../../../apps/daemon/src/store/EventStore.ts";
import { startServer } from "../../../../apps/daemon/src/transport/server.ts";
import { lazyLanguageHandlers } from "../../../../apps/daemon/src/transport/lazyLanguages.ts";
import { startSampler } from "../../../../packages/bench/src/sampler.ts";
import type { LanguageApi } from "../../../../apps/desktop/src/shared/api.ts";
import { LanguageFeatures } from "../../../../apps/desktop/src/renderer/features/editor/lsp/features.ts";
import { EditorLanguageSession } from "../../../../apps/desktop/src/renderer/features/editor/lsp/sessions.ts";
import { languageDiagnosticsVerifier } from "../../../../apps/desktop/src/renderer/features/editor/lsp/verify.ts";
import type { CaseStates } from "./dv-states.ts";

const [statesFile = "", server = "tsls", mode = "verify", limit = "82", outFile = ""] = process.argv.slice(2);
const here = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const node = process.env.DV_NODE ?? Bun.which("node")!;
const tsgo = `${here}/node_modules/.bun/@typescript+typescript-darwin-arm64@7.0.2/node_modules/@typescript/typescript-darwin-arm64/lib/tsc`;

const rows = ((await Bun.file(statesFile).json()) as CaseStates[])
  .filter((c) => existsSync(`${here}/${c.path}`) && c.states.some((s) => !s.truth))
  .toSorted((a, b) => a.id.localeCompare(b.id))
  .slice(0, Number(limit));

/** One replace hunk from the common prefix and suffix. */
const editOf = (before: string, after: string) => {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return { from: start, to: before.length - end, text: after.slice(start, after.length - end) };
};

// The managed launch's options (managedDelivery.ts): tsls's override argv cannot carry them.
const proxy = `import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
process.on("uncaughtException", (error) => { appendFileSync(${JSON.stringify(process.env.DV_PROXY_LOG ?? "/dev/null")}, String(error.stack) + "\\n"); process.exit(1); });
const child = spawn(${JSON.stringify(node)}, [${JSON.stringify(process.env.DV_TSLS)}, "--stdio"], { stdio: ["pipe", "inherit", "inherit"] });
let buffer = Buffer.alloc(0), first = true;
process.stdin.on("data", (chunk) => {
  if (!first) return void child.stdin.write(chunk);
  buffer = Buffer.concat([buffer, chunk]);
  const end = buffer.indexOf("\\r\\n\\r\\n");
  if (end < 0) return;
  const length = Number(/Content-Length: (\\d+)/i.exec(buffer.slice(0, end).toString())[1]);
  if (buffer.length < end + 4 + length) return;
  const message = JSON.parse(buffer.slice(end + 4, end + 4 + length).toString());
  message.params.initializationOptions = { ...message.params.initializationOptions, tsserver: { path: ${JSON.stringify(process.env.DV_TSSERVER)}, useSyntaxServer: "never" }, disableAutomaticTypingAcquisition: true, plugins: [] };
  const body = Buffer.from(JSON.stringify(message));
  child.stdin.write(Buffer.concat([Buffer.from("Content-Length: " + body.length + "\\r\\n\\r\\n"), body, buffer.slice(end + 4 + length)]));
  first = false;
});
process.stdin.on("end", () => child.stdin.end());
child.on("exit", (code) => process.exit(code ?? 0));
`;

const quantile = (xs: number[], p: number) => xs.toSorted((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? NaN;

const program = Effect.gen(function* () {
  const root = yield* Effect.acquireRelease(
    Effect.promise(async () => realpath(await mkdtemp("/tmp/polaris-dvw-"))),
    (r) => Effect.promise(() => rm(r, { recursive: true, force: true }))
  );
  yield* Effect.promise(() => writeFile(join(root, "tsls.mjs"), proxy));
  const workspaceId = P.WorkspaceId.make("dvw");
  const store = yield* EventStore;
  yield* store.commit({
    commandId: null,
    decide: () =>
      Effect.succeed([
        P.DomainEvent.cases.WorkspaceRegistered.make({
          workspace: new P.Workspace({ id: workspaceId, path: here, name: "dvw", isGitRepo: true, worktreeRoot: join(root, "trees"), hidden: false, registeredAt: new Date().toISOString() }),
        }),
      ]),
  });
  const caps: P.Capability[] = ["languages", "languages.trust"];
  const daemon = yield* startServer({ root, socketPath: join(root, "d.sock"), lockPath: join(root, "d.lock"), capabilities: caps, handlers: lazyLanguageHandlers });
  const rpc = yield* connectRpc(yield* socketTransport(daemon.socketPath));
  const hello = yield* rpc.client.hello({ clientName: "dv-wired", clientVersion: "0", deviceLabel: "isolated", capabilities: caps, languageProof: Redacted.make("f".repeat(64)) });
  const identity = hello.languageIdentity!;
  yield* rpc.client["languages.trust.set"]({ scope: P.LanguageTrustScope.cases.Workspace.make({ hostId: hello.host.hostId, workspaceId }), trusted: true, expectedRevision: 0 });
  const checkout = P.LanguageCheckout.cases.Workspace.make({ workspaceId, path: here });
  const settings = P.LanguageEffectiveSettings.make({
    revision: 0, formatOnSave: false, formatter: P.LanguageFormatterSelection.cases.None.make({}), providers: ["typescript-language-server"], origins: {},
    settings: { executableOverrides: { "typescript-language-server": server === "tsgo" ? { executable: tsgo, argv: ["--lsp", "--stdio"], environment: {} } : { executable: node, argv: [join(root, "tsls.mjs")], environment: {} } } },
  });

  // The renderer's LanguageApi as main's bridge forwards it: the Host key dropped, results as JSON.
  const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(Effect.result(effect));
  const api: LanguageApi = {
    request: async (method, raw) => {
      const { hostKey: _hostKey, ...input } = raw as Record<string, unknown>;
      // SAFETY: the harness forwards only methods the Daemon's RPC group defines.
      const call = (rpc.client as unknown as Record<string, (input: unknown) => Effect.Effect<unknown, unknown>>)[method]!;
      const result = await run(call(input));
      if (process.env.DV_DEBUG) console.error(method, result._tag, JSON.stringify(result._tag === "Success" ? result.success : String(result.failure)).slice(0, 300));
      if (result._tag === "Success") return { ok: true, value: JSON.parse(JSON.stringify(result.success)) };
      const error = result.failure;
      return { ok: false, error: { code: "LanguageError", message: String((error as Error)?.message ?? error), ...(Schema.is(P.LanguageError)(error) ? { languageError: error } : {}) } };
    },
    subscribe: (_kind, raw, listener) => {
      const { context } = raw as { context: P.LanguageContextIdentity };
      const fiber = Effect.runFork(
        rpc.client["languages.context.watch"]({ context }).pipe(
          Stream.runForEach((event) => Effect.sync(() => { if (process.env.DV_DEBUG) console.error("event", JSON.stringify(event).replace(/"context":{[^}]*{[^}]*}[^}]*}/g, "").slice(0, 1500)); listener.items([JSON.parse(JSON.stringify(event))]); })),
          Effect.ensuring(Effect.sync(() => listener.end(null)))
        )
      );
      return () => void Effect.runFork(Fiber.interrupt(fiber));
    },
  };

  yield* rpc.client["languages.discover"]({ checkout, path: join(here, rows[0]!.path), documentLanguageId: "typescript", settings });
  const acquisition = { clientId: identity.clientId, contextId: "dvw", checkout, path: join(here, rows[0]!.path), providerId: "typescript-language-server", settings, interestId: "dvw" };
  const session = new EditorLanguageSession(api, "h", acquisition, hello.host.hostId, (event) => {
    const { request } = event.request;
    const items = Schema.decodeUnknownOption(Schema.Struct({ items: Schema.Array(Schema.Unknown) }))(request.params);
    void api.request("languages.server.respond", { hostKey: "h", context: event.request.context, response: { jsonrpc: "2.0", id: request.id, result: request.method === "workspace/configuration" && items._tag === "Some" ? items.value.items.map(() => null) : null } });
  });

  if (process.env.DV_DEBUG) console.error("root", root);
  return yield* Effect.promise(async () => {
  const sampler = startSampler({ roots: () => [process.pid], intervalMs: 200 });
  const results: { id: string; path: string; lines: number; ms: number; verdict: string }[] = [];
  for (const c of rows) {
    const uri = `file://${encodeURI(join(here, c.path))}`;
    const language = c.path.endsWith(".tsx") ? "tsx" : "typescript";
    let doc = Text.of(c.buffer.split("\n"));
    let version = 1;
    const read = () => ({ uri, doc, version, lineSeparator: "\n" as const });
    const detach = session.attach({ read, language: () => language, changed: () => undefined });
    const features = new LanguageFeatures({ api, buffer: read, providers: () => { const p = session.provider(uri); return p === null ? [] : [p]; } });
    const verifier = languageDiagnosticsVerifier({ features, read, language, groups: [session] }, api);
    for (let i = 0; i < 600 && session.provider(uri) === null; i++) await Bun.sleep(50);
    if (session.provider(uri) === null) throw new Error(`no provider for ${c.id}`);
    await Bun.sleep(1500);
    const states = c.states.filter((s) => s.truth === (process.env.DV_TRUTH === "1")).slice(0, 3);
    for (const state of states) {
      // The user's last keystroke, then the 150 ms pause and about 600 ms of model time.
      doc = Text.of(c.buffer.slice(0, -1).split("\n")); version++; session.edited(uri);
      await Bun.sleep(100);
      doc = Text.of(c.buffer.split("\n")); version++; session.edited(uri);
      await Bun.sleep(750);
      if (mode !== "verify") continue;
      const edit = editOf(c.buffer, state.after);
      const start = performance.now();
      const controller = new AbortController();
      const cap = setTimeout(() => controller.abort(), 10_000);
      const verdict = await verifier.verify({ doc, edits: [edit], cursor: edit.from }, controller.signal);
      clearTimeout(cap);
      const ms = controller.signal.aborted ? Number.POSITIVE_INFINITY : performance.now() - start;
      const label = verdict === null ? "failed" : verdict.allow ? "allow" : `reject:${[...verdict.introduced.map((d) => d.message), ...verdict.shadowed.map((d) => `stand-in ${d.message}`)].join(" | ").replace(/\s+/g, " ").slice(0, 200)}`;
      results.push({ id: c.id, path: c.path, lines: c.buffer.split("\n").length, ms, verdict: label });
      await Bun.sleep(300);
    }
    detach();
    process.stderr.write(".");
  }
  const usage = sampler.report();
  sampler.stop();
  session.dispose();
  return { results, usage };
  });
});

const { results, usage } = await Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(EventStore.layerSqlite(":memory:"))));
if (outFile) await Bun.write(outFile, results.map((r) => `${r.id}\t${r.path}\t${r.lines}\t${Math.round(r.ms)}\t${r.verdict}`).join("\n") + "\n");
const ms = results.map((r) => r.ms);
const over = (limit: number) => `${(100 * ms.filter((x) => x > limit).length / Math.max(1, ms.length)).toFixed(1)}%`;
console.log(JSON.stringify({
  server, mode, cases: rows.length, checks: results.length,
  p50: Math.round(quantile(ms, 0.5)), p90: Math.round(quantile(ms, 0.9)), p95: Math.round(quantile(ms, 0.95)),
  over: { 300: over(300), 600: over(600), 1000: over(1000), 2000: over(2000) },
  failed: results.filter((r) => r.verdict === "failed").length,
  rejected: results.filter((r) => r.verdict.startsWith("reject")).length,
  usage,
}));
process.exit(0);
