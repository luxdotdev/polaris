import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import {
  PredictionOutcome,
  outcomeLanguageId,
  outcomeModelId,
  type PredictionLogRecord,
} from "../../shared/predictionOutcomes.ts";
import { PredictionOutcomes, predictionMetrics } from "./outcomes.ts";

const outcome = (patch: Partial<PredictionOutcome> = {}): PredictionOutcome => ({
  time: 1000,
  language: "typescript",
  model: "zeta-2.1",
  format: "zeta-2.1",
  side: "client",
  kind: "replace",
  hunkCount: 1,
  linesAdded: 2,
  linesRemoved: 1,
  requestToFinalMs: 120,
  finalToShownMs: 2,
  outcome: "accepted",
  undoneWithin30s: false,
  guard: null,
  ...patch,
});

test("Outcome boundary rejects source, paths, identifiers and arbitrary string values", () => {
  const decode = Schema.decodeUnknownSync(PredictionOutcome);

  for (const patch of [
    { text: "secret source" },
    { path: "/private/project.ts" },
    { workspaceId: "secret-id" },
    { constructor: "private" },
    { language: "secret_identifier" },
    { model: "/private/models/zeta-2.1.gguf" },
    { requestToFinalMs: Infinity },
    { hunkCount: -1 },
    { outcome: "ignored", undoneWithin30s: true },
    { outcome: null, finalToShownMs: null, guard: null },
  ])
    expect(() => decode({ ...outcome(), ...patch })).toThrow();
});

test("Outcome IDs normalize endpoint aliases without retaining private prefixes", () => {
  expect(outcomeModelId("/Users/private/models/Zeta-2.1-Q4.gguf")).toBe("zeta-2.1");
  expect(outcomeModelId("private-org/Sweep-Next-Edit:Q8")).toBe("sweep-next-edit");
  expect(outcomeModelId("/private/custom-model.gguf")).toBe("unknown");
  expect(outcomeLanguageId("private-language-id")).toBe("unknown");
  expect(outcomeLanguageId("typescriptreact")).toBe("typescriptreact");
});

test("Metrics use only the last 200 shown for acceptance and exclude never-shown guards", () => {
  const records: PredictionLogRecord[] = [
    ...Array.from({ length: 20 }, (_, time) => outcome({ time, outcome: "accepted" })),
    ...Array.from({ length: 150 }, (_, time) =>
      outcome({ time: time + 20, outcome: "ignored", kind: "insert" })
    ),
    ...Array.from({ length: 50 }, (_, time) =>
      outcome({ time: time + 170, undoneWithin30s: time < 7, kind: "jump" })
    ),
    outcome({ outcome: null, finalToShownMs: null, guard: "revert" }),
    { keystrokes: 1000 },
    { keystrokes: 1000 },
  ];

  expect(predictionMetrics(records)).toEqual({
    shown: 220,
    accepted: 70,
    acceptanceWindow: 200,
    acceptanceRate: 0.25,
    keystrokes: 2000,
    shownPer100Keystrokes: 11,
    undoneWithin30s: 7,
    undoneRate: 0.1,
    countsByKind: { insert: 150, replace: 20, delete: 0, import: 0, jump: 50 },
  });
  expect(predictionMetrics([])).toMatchObject({
    acceptanceRate: null,
    shownPer100Keystrokes: null,
    undoneRate: null,
  });
});

test("A full 5 MB log drops exactly its oldest half and appends survive restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "polaris-outcomes-cap-"));
  const path = join(dir, "outcomes.jsonl");

  try {
    const line = `${JSON.stringify(outcome())}\n`;
    const count = Math.floor(4_999_999 / Buffer.byteLength(line));
    await writeFile(path, line.repeat(count));
    const store = new PredictionOutcomes(path);
    store.record(outcome({ kind: "delete", time: 10000 }));
    await store.close();
    const rows = (await readFile(path, "utf8")).trim().split("\n");
    expect(rows.length).toBe(Math.floor((count + 1) / 2));
    expect(JSON.parse(rows.at(-1)!)).toMatchObject({ kind: "delete" });
    expect((await stat(path)).size).toBeLessThan(5_000_000);
    const reopened = new PredictionOutcomes(path);
    expect(await reopened.metrics()).toMatchObject({
      shown: rows.length,
      countsByKind: { delete: 1, replace: rows.length - 1 },
    });
    await reopened.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Fire-and-forget writes batch, clear orders pending writes, and shutdown flushes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "polaris-outcomes-clear-"));
  const path = join(dir, "outcomes.jsonl");
  const store = new PredictionOutcomes(path);

  try {
    store.record(outcome());
    store.keystrokes({ keystrokes: 100 });
    const cleared = store.clear();
    store.record(outcome({ kind: "import" }));
    store.keystrokes({ keystrokes: 20 });
    await cleared;
    expect(await store.metrics()).toMatchObject({
      shown: 1,
      keystrokes: 20,
      countsByKind: { import: 1, replace: 0 },
    });
    store.record(outcome({ outcome: "dismissed-esc" }));
    await store.close();
    const reopened = new PredictionOutcomes(path);
    expect(await reopened.metrics()).toMatchObject({ shown: 2, acceptanceRate: 0.5 });
    await reopened.clear();
    expect(await readFile(path, "utf8")).toBe("");
    expect(await reopened.metrics()).toMatchObject({ shown: 0, keystrokes: 0 });
    await reopened.close();
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Restart repairs a torn tail and rejects historical records carrying private fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "polaris-outcomes-repair-"));
  const path = join(dir, "outcomes.jsonl");

  try {
    await writeFile(
      path,
      `${JSON.stringify({ ...outcome(), text: "private" })}\n${JSON.stringify(outcome())}\n{"time":`
    );
    const store = new PredictionOutcomes(path);
    store.record(outcome({ kind: "insert" }));
    await store.close();
    const source = await readFile(path, "utf8");
    expect(source).not.toContain("private");
    expect(
      source
        .trim()
        .split("\n")
        .map(
          (line) => Schema.decodeUnknownSync(Schema.fromJsonString(PredictionOutcome))(line).kind
        )
    ).toEqual(["replace", "insert"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Acceptance follows shown timestamps even when settled outcomes arrive out of order", async () => {
  const dir = await mkdtemp(join(tmpdir(), "polaris-outcomes-order-"));
  const store = new PredictionOutcomes(join(dir, "outcomes.jsonl"));

  try {
    for (let time = 1; time <= 200; time++) store.record(outcome({ time, outcome: "ignored" }));
    store.record(outcome({ time: 0 }));
    expect(await store.metrics()).toMatchObject({ shown: 201, acceptanceRate: 0 });
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
