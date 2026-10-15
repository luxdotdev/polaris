// Builds the fresh held-out requests (fresh-cases.json) the same way as hardening-build.ts.
import { createHash } from "node:crypto";
import { buildCase, changed } from "./build.ts";
import { diffEdits } from "../../../../packages/predict/src/edit/diff.ts";

const root = new URL("../../../../packages/predict/src/edit/fixtures/", import.meta.url);
const specs = await Bun.file(new URL("./fresh-cases.json", import.meta.url)).json();
const rows = [];
for (const spec of specs) {
  const c = await buildCase(spec);
  const step = c.steps.at(-1)!;
  const current = step.states.at(-1)!;
  const buffer = current.join("\n");
  const history = step.states.slice(1).map((after, i) => {
    const before = step.states[i]!;
    const [line, endBefore, endAfter] = changed(before, after);
    return { path: c.path, line, before: before.slice(line, endBefore).join("\n"), after: after.slice(line, endAfter).join("\n") };
  });
  const cursor = current.slice(0, step.cursorLine).reduce((n, line) => n + line.length + 1, 0) + step.cursorCol;
  rows.push({ id: c.id, category: c.cat, split: "fresh", path: c.path, buffer, cursor, history,
    expected: diffEdits(buffer, c.expected.join("\n")), allowed: c.allowed.map((a) => diffEdits(buffer, a.join("\n"))) });
}
const text = JSON.stringify(rows) + "\n";
await Bun.write(new URL("fresh-cases.json", root), text);
console.log(`Built ${rows.length} fresh cases, sha256 ${createHash("sha256").update(text).digest("hex")}; no model outputs read`);
