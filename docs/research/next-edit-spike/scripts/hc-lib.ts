// Shared pieces of the Sweep hill-climb (2026-10-15): case sets, variants, labels and scoring.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Schema } from "effect";
import { EditPredictionRequest, PredictedEdit } from "../../../../packages/protocol/src/index.ts";
import { request as base } from "../../../../packages/predict/src/edit/fixtures.testing.ts";
import { applyEdits } from "../../../../packages/predict/src/edit/guards.ts";
import { editResult } from "../../../../packages/predict/src/edit/result.ts";
import { spikeSweepOptions, type SweepOptions } from "../../../../packages/predict/src/edit/options.ts";

export const fixtures = new URL("../../../../packages/predict/src/edit/fixtures/", import.meta.url);
export const rawDir = new URL("../raw/hc/", import.meta.url);

const Case = Schema.Struct({ id: Schema.String, split: Schema.String, category: Schema.String,
  path: Schema.String, buffer: Schema.String, cursor: Schema.Number, history: EditPredictionRequest.fields.history,
  expected: Schema.Array(PredictedEdit), allowed: Schema.Array(Schema.Array(PredictedEdit)) });
export type Case = typeof Case.Type;
export type Label = "exact" | "acceptable" | "wrong" | "dangerous" | "abstain";
export type Output = { id: string; output: string; elapsedMs: number; error?: string };

/** The keystroke before: one character less before the cursor, in the buffer and the last hunk. */
export const previousKeystroke = (c: Case): Case | null => {
  if (c.cursor === 0 || c.buffer[c.cursor - 1] === "\n") return null;
  const buffer = c.buffer.slice(0, c.cursor - 1) + c.buffer.slice(c.cursor);
  const history = [...c.history];
  const last = history.findLastIndex((h) => h.path === c.path);
  const hunk = history[last];
  if (hunk) {
    const start = c.buffer.split("\n").slice(0, hunk.line).reduce((n, l) => n + l.length + 1, 0);
    if (start + hunk.after.length === c.cursor) history[last] = { ...hunk, after: hunk.after.slice(0, -1) };
  }
  return { ...c, buffer, cursor: c.cursor - 1, history, expected: [], allowed: [] };
};

export const loadSet = async (set: string): Promise<Case[]> => {
  if (set === "devprev") return (await loadSet("dev")).flatMap((c) => previousKeystroke(c) ?? []);
  const file = set === "fresh" ? "fresh-cases.json" : "hardening-cases.json";
  if (set === "fresh" && process.env.HC_FINAL !== "1") throw new Error("The fresh set is frozen until the final evaluation (HC_FINAL=1)");
  return Schema.decodeUnknownSync(Schema.Array(Case))(await Bun.file(new URL(file, fixtures)).json());
};

export type Variant = { options: SweepOptions; maxTokens?: number };
const v = (o: Partial<SweepOptions>, extra: Omit<Variant, "options"> = {}): Variant => ({ options: { ...spikeSweepOptions, ...o }, ...extra });
export const variants: Record<string, Variant> = {
  base: v({}),
  w15: v({ above: 7, below: 7 }),
  w31: v({ above: 15, below: 15 }, { maxTokens: 1024 }),
  ctx1: v({ historyContext: 1 }),
  nolast: v({ lastAsDiff: false }),
  card: v({ historyContext: 1, lastAsDiff: false }),
  w25: v({ above: 12, below: 12 }, { maxTokens: 1024 }),
  w41: v({ above: 20, below: 20 }, { maxTokens: 1024 }),
  a10b20: v({ above: 10, below: 20 }, { maxTokens: 1024 }),
  a20b10: v({ above: 20, below: 10 }, { maxTokens: 1024 }),
  a5b20: v({ above: 5, below: 20 }, { maxTokens: 1024 }),
  a10b30: v({ above: 10, below: 30 }, { maxTokens: 1024 }),
  a15b20: v({ above: 15, below: 20 }, { maxTokens: 1024 }),
  a10b15: v({ above: 10, below: 15 }, { maxTokens: 1024 }),
  near: v({ nearestFallback: true }),
  novel: v({ novelNames: true }),
  decl: v({ declarationRenames: true }),
  removed: v({ removedNames: true }),
  names: v({ novelNames: true, declarationRenames: true, removedNames: true }),
  guards: v({ novelNames: true, declarationRenames: true, removedNames: true, deletionEvidence: true, relevance: true }),
};

/** "a+b" merges variants left to right. */
export const variantOf = (name: string): Variant => {
  const parts = name.split("+").map((n) => {
    const found = variants[n];
    if (!found) throw new Error(`Unknown variant ${n}`);
    return found;
  });
  const diff = (x: Variant) => Object.fromEntries(Object.entries(x.options).filter(([k, val]) => spikeSweepOptions[k as keyof SweepOptions] !== val));
  return parts.reduce((acc, x) => ({ ...acc, ...x, options: { ...acc.options, ...diff(x) } }), variants.base!);
};

export const requestFor = (c: Case, port = 8091, maxTokens = 512) =>
  EditPredictionRequest.make({ ...base, path: c.path, buffer: c.buffer, cursor: c.cursor, history: c.history,
    format: "sweep-next-edit", model: "sweep", maxTokens, endpoint: { kind: "openai", url: `http://127.0.0.1:${port}` } });

export const normalized = (s: string) => s.replace(/\s/g, "");
export const stateHash = (buffer: string) => createHash("sha256").update(normalized(buffer)).digest("hex").slice(0, 16);

export const labelsFile = new URL("labels.json", rawDir);
export type Labels = Record<string, Record<string, { label: Label; note: string }>>;
export const loadLabels = async (): Promise<Labels> => (await Bun.file(labelsFile).exists() ? Bun.file(labelsFile).json() : {});

/** Shown result of one recorded output: post-processing and guards, then the rubric label of its buffer. */
export const score = (c: Case, recorded: Output, variant: Variant, labels: Labels) => {
  const input = requestFor(c);
  if (recorded.error) return { label: "abstain" as Label, shown: c.buffer, hash: "", edits: [], suppressed: [], error: recorded.error };
  const result = editResult(input, recorded.output, 0, variant.options);
  const shown = applyEdits(c.buffer, result.edits);
  const hash = stateHash(shown);
  const label: Label | "unlabelled" = !result.edits.length ? "abstain"
    : c.allowed.some((p) => normalized(applyEdits(c.buffer, p)) === normalized(shown)) ? "exact"
    : labels[c.id]?.[hash]?.label ?? "unlabelled";
  return { label, shown, hash, edits: result.edits, suppressed: result.suppressed };
};

export const udiff = (a: string, b: string) => {
  const fa = `${tmpdir()}/hc-a-${process.pid}`, fb = `${tmpdir()}/hc-b-${process.pid}`;
  writeFileSync(fa, a.endsWith("\n") ? a : a + "\n");
  writeFileSync(fb, b.endsWith("\n") ? b : b + "\n");
  return Bun.spawnSync(["diff", "-U1", fa, fb]).stdout.toString().split("\n").slice(2).join("\n");
};

export const review = (c: { id: string; category: string; path: string; buffer: string; cursor: number; history: readonly { line: number; before: string; after: string }[]; expected: readonly { from: number; to: number; text: string }[] }, after: string, note = "") =>
  `## ${c.id} ${c.category} ${c.path} hash=${stateHash(after)} cursorLine=${c.buffer.slice(0, c.cursor).split("\n").length} ${note}\n### history\n${c.history.map((h) => `@L${h.line + 1}\n-${h.before.replace(/\n/g, "\n-")}\n+${h.after.replace(/\n/g, "\n+")}`).join("\n")}\n### shown\n${udiff(c.buffer, after)}\n### expected\n${udiff(c.buffer, applyEdits(c.buffer, c.expected))}\n`;
