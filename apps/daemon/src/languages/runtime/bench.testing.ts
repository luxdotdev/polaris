import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  LanguageDocumentNotification,
  LanguageFeatureRequest,
  LanguageSyncInput,
} from "@polaris/protocol";
import { fixture } from "./fixtures.testing.ts";
import { spawnLanguageProcess } from "./process.ts";
import { OrderedConnection } from "../transport/index.ts";
import { startSampler } from "../../../../../packages/bench/src/sampler.ts";

const mode = process.argv[2];

const destination = process.argv[3];

if ((mode !== "control" && mode !== "broker") || destination === undefined)
  throw new Error("usage: bench.testing.ts control|broker <owned-result.json>");

const results = [];

for (let run = 0; run < 3; run++) {
  const f = await fixture();
  let control: OrderedConnection | undefined;
  let controlPid: number | undefined;
  const host = startSampler({ roots: () => [process.pid], intervalMs: 100 });

  const child = startSampler({
    roots: () => (controlPid === undefined ? f.processes.map((port) => port.pid) : [controlPid]),
    intervalMs: 100,
  });

  const started = performance.now();
  const latencies = [];
  let firstDiagnostic: number | null = null;
  let abort: AbortController | undefined;

  try {
    await Bun.sleep(1000);
    const idle = host.report();
    const start = performance.now();
    const acquired = await f.acquire();
    const context = acquired.context;
    abort = new AbortController();

    if (mode === "broker") {
      void (async () => {
        for await (const event of f.broker.watch("one", context, abort.signal)) {
          if (firstDiagnostic === null && "diagnostics" in event)
            firstDiagnostic = performance.now() - start;
        }
      })().catch(() => {});
    } else {
      const port = spawnLanguageProcess({
        executable: process.execPath,
        args: [join(import.meta.dir, "fake-server.testing.ts")],
        cwd: f.root,
        environment: {},
      });

      controlPid = port.pid;
      control = new OrderedConnection(
        port,
        (message) => {
          if ("method" in message && message.method === "workspace/configuration")
            void control?.send({ jsonrpc: "2.0", id: "config", result: ["configured", null] });

          if (
            "method" in message &&
            message.method === "textDocument/publishDiagnostics" &&
            firstDiagnostic === null
          )
            firstDiagnostic = performance.now() - start;
        },
        () => {}
      );
      await control.request("initialize", { rootUri: pathToFileURL(f.root).href }).result;
      await control.send({ jsonrpc: "2.0", method: "initialized", params: {} });
    }

    const uris: string[] = [];
    const text = "a".repeat(16384);

    for (let index = 0; index < 20; index++) {
      const path = join(f.root, `file${index}.ts`);
      await writeFile(path, "saved");
      const uri = pathToFileURL(path).href;
      uris.push(uri);

      if (mode === "broker")
        await f.broker.sync(
          "one",
          LanguageSyncInput.make({
            context,
            sequence: index + 1,
            notification: LanguageDocumentNotification.cases.Open.make({
              uri,
              version: 1,
              text,
              languageId: "typescript",
            }),
          })
        );
      else
        await control!.send({
          jsonrpc: "2.0",
          method: "textDocument/didOpen",
          params: { textDocument: { uri, version: 1, text, languageId: "typescript" } },
        });
    }

    if (mode === "broker") await f.ready("one", context);
    const startupMs = performance.now() - start;

    for (let index = 0; index < 30; index++) {
      const requestStart = performance.now();
      const params = { textDocument: { uri: uris[index % 20]! } };

      if (mode === "broker")
        await f.broker.request(
          "one",
          LanguageFeatureRequest.make({
            requestId: `request${index}`,
            fence: {
              context,
              requiredSequence: 20,
              documents: [{ uri: uris[index % 20]!, version: 1 }],
            },
            method: "textDocument/hover",
            params,
            deadline: Date.now() + 1000,
          })
        );
      else await control!.request("textDocument/hover", params).result;
      latencies.push(performance.now() - requestStart);
    }

    await Bun.sleep(1000);
    host.sample();
    child.sample();
    const hostReport = host.report();
    const children = child.report();
    const cleanupStart = performance.now();
    abort.abort();

    if (control !== undefined) await control.close();
    await f.dispose();
    results.push({
      run,
      idle,
      startupMs,
      firstDiagnosticMs: firstDiagnostic,
      latencyMs: latencies,
      host: hostReport,
      children,
      cleanupMs: performance.now() - cleanupStart,
      final: f.broker.stats(),
      durationMs: performance.now() - started,
    });
  } finally {
    abort?.abort();
    await control?.close();
    await f.dispose();
    host.stop();
    child.stop();
  }
}

await writeFile(
  destination,
  JSON.stringify({ mode, source: "bounded-synthetic-stdio", documents: 20, results }, null, 2)
);

console.log(`Synthetic ${mode}: ${results.length} runs; owned processes and fixtures cleaned`);
