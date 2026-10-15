// Rebuild compact frozen requests and commit-derived targets without querying a model.
import { Schema } from "effect";
import { buildCase, changed } from "./build.ts";
import { diffEdits } from "../../../../packages/predict/src/edit/diff.ts";
import { fixtures } from "../../../../packages/predict/src/edit/fixtures.testing.ts";

const root = new URL("../../../../packages/predict/src/edit/fixtures/", import.meta.url);
const Spec = Schema.Struct({ id: Schema.String, cat: Schema.String, commit: Schema.String,
  path: Schema.String, hist: Schema.Array(Schema.Number), target: Schema.Array(Schema.Number),
  typed: Schema.optional(Schema.Number), split: Schema.Literals(["dev", "test"]) });
const specs = Schema.decodeUnknownSync(Schema.Array(Spec))(await Bun.file(new URL("./cases.json", import.meta.url)).json());
const rows = [];
for (const spec of specs) {
  const existing = fixtures.find((f) => f.id === spec.id);
  if (existing) {
    const { outputs: _, ...input } = existing;
    rows.push({ ...input, split: spec.split });
    continue;
  }
  const c = await buildCase({ ...spec, hist: [...spec.hist], target: [...spec.target] });
  const step = c.steps.at(-1)!;
  const current = step.states.at(-1)!;
  const buffer = current.join("\n");
  const history = step.states.slice(1).map((after, i) => {
    const before = step.states[i]!;
    const [line, endBefore, endAfter] = changed(before, after);
    return { path: c.path, line, before: before.slice(line, endBefore).join("\n"), after: after.slice(line, endAfter).join("\n") };
  });
  const cursor = current.slice(0, step.cursorLine).reduce((n, line) => n + line.length + 1, 0) + step.cursorCol;
  rows.push({ id: c.id, category: c.cat, split: spec.split, path: c.path, buffer, cursor, history,
    expected: diffEdits(buffer, c.expected.join("\n")), allowed: c.allowed.map((a) => diffEdits(buffer, a.join("\n"))) });
}
await Bun.write(new URL("hardening-cases.json", root), JSON.stringify(rows) + "\n");
console.log(`Built ${rows.length} cases; no model outputs read`);
