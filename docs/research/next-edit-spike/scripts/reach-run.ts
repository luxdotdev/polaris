// Opt-in acquisition: Sweep at every focus the compared policies would probe (first three each).
import { EditPredictionRequest } from "../../../../packages/protocol/src/index.ts";
import { hardeningCases, hardeningRequest } from "../../../../packages/predict/src/edit/hardening.testing.ts";
import { editWindow } from "../../../../packages/predict/src/edit/window.ts";
import { endpointDeltas } from "../../../../packages/predict/src/endpoint.ts";
import { buildEditPrompt } from "../../../../packages/predict/src/edit/prompt.ts";
import { focusesFor, variants } from "./reach-variants.ts";

const split = process.argv[2];
const only = process.argv[3];
if (process.env.POLARIS_PREDICTION_LIVE !== "1" || !["dev", "test"].includes(split ?? ""))
  throw new Error("Set POLARIS_PREDICTION_LIVE=1 and pass dev or test");
const url = process.env.POLARIS_EDIT_URL ?? "http://127.0.0.1:8093";
const dest = new URL(`../reach/${split}.outputs.json`, import.meta.url);
const rows: { id: string; focus: number; output: string; elapsedMs: number }[] =
  (await Bun.file(dest).exists()) ? await Bun.file(dest).json() : [];
const have = new Set(rows.map((r) => `${r.id}@${r.focus}`));
const names = only ? only.split(",") : Object.keys(variants);
for (const c of hardeningCases.filter((c) => c.split === split)) {
  const base = hardeningRequest(c, "sweep-next-edit");
  const window = editWindow(base);
  if (c.expected.every((e) => e.from >= window.from && e.to <= window.to)) continue;
  const focuses = new Set(names.flatMap((v) => focusesFor(v, c, window).slice(0, 3)));
  for (const focus of focuses) {
    if (have.has(`${c.id}@${focus}`)) continue;
    const request = EditPredictionRequest.make({ ...base, focus, endpoint: { kind: "openai", url },
      model: "sweep-next-edit", maxTokens: 512 });
    const start = performance.now();
    let output = "";
    for await (const delta of endpointDeltas(request, buildEditPrompt(request), AbortSignal.timeout(120000), globalThis.fetch))
      output += delta;
    rows.push({ id: c.id, focus, output, elapsedMs: performance.now() - start });
    have.add(`${c.id}@${focus}`);
    await Bun.write(dest, JSON.stringify(rows) + "\n");
    process.stderr.write(`${c.id}@${focus} `);
  }
}
console.log(`\n${rows.length} probe outputs in ${dest.pathname}`);
