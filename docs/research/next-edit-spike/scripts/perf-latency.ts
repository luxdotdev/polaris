// perf-latency.ts <serve.json> <out.jsonl> [runs] [format]: the production edit predictor (2048 output tokens, as
// the Desktop App asks) against the managed server (perf-setup.ts serve), over the dev and fresh cases
// (HC_FINAL=1). "file" is the first request in a file; "keystroke" follows the keystroke before it.
import { loadavg } from "node:os";
import { appendFileSync } from "node:fs";
import { Effect, Stream } from "effect";
import { createEditPredictor } from "../../../../packages/predict/src/index.ts";
import { loadSet, previousKeystroke, requestFor, type Case } from "./hc-lib.ts";

const [serveFile = "", out = "", runsArg = "3", format = "sweep-next-edit"] = process.argv.slice(2);
const serve = (await Bun.file(serveFile).json()) as { url: string; alias: string };
const port = Number(new URL(serve.url).port);
const predictor = createEditPredictor();
const cases = [...(await loadSet("dev")), ...(await loadSet("fresh"))];

const once = async (c: Case) => {
  const input = { ...requestFor(c, port, 2048), model: serve.alias, format: format as "sweep-next-edit" };
  const timing: Record<string, number> = {};
  const t0 = performance.now();
  const [final] = await Effect.runPromise(
    predictor.predict(input, { signal: AbortSignal.timeout(120_000), onTiming: (stage, ms) => (timing[stage] = ms) }).pipe(Stream.runCollect)
  ).catch((error: Error) => [{ error: error.message, elapsedMs: null, edits: [] }]);
  return { error: final && "error" in final ? final.error : null, totalMs: performance.now() - t0, finalMs: final?.elapsedMs ?? null, promptMs: timing.prompt ?? null, firstTokenMs: timing.firstToken ?? null, edits: final?.edits.length ?? 0 };
};

for (let run = 1; run <= Number(runsArg); run++)
  for (const c of cases) {
    const load = loadavg()[0]!;
    const file = await once(c);
    const prev = previousKeystroke(c);
    let keystroke = null;
    if (prev) {
      await once(prev);
      keystroke = await once(c);
    }
    appendFileSync(out, JSON.stringify({ run, id: c.id, split: c.split, load: Math.round(load * 100) / 100, file, keystroke }) + "\n");
    process.stderr.write(".");
  }
console.error(`\n${out}`);
