import { describe, expect, test } from "bun:test";
import { SessionId } from "@polaris/protocol";
import { asPlain } from "../../../store/plain.ts";
import { attempt, constellationOf, STUDIO, task } from "../preview/graph.ts";
import { setupRun } from "../preview/setup.ts";
import { attentionItems } from "./attention.ts";
import { NO_FACTS, plainFacts, type WorkerFacts } from "./facts.ts";
import { startedRecord } from "./fold.ts";
import { buildRail } from "./rail.ts";
import type { SetupFact } from "./setup.ts";
import type { TaskRow } from "./task.ts";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const IDS = ["S1", "S2", "S3", "S4", "S5"] as const;

const record = startedRecord(
  constellationOf({
    tasks: IDS.map((id) => task({ id, title: `Worker ${id}` })),
    attempts: IDS.map((taskId) => attempt({ taskId, state: "working", minutes: 22 })),
  }),
  3
);

// Each worker's setup completed before its Attempt started (ENG-263's incident).
const setup = (taskId: string, run = setupRun(taskId, "completed", 23, 0)): SetupFact => ({
  run: asPlain(run),
  hostKey: "local",
  hostId: STUDIO,
  sessionId: SessionId.make(`worker-${taskId}`),
  remoteHost: null,
  failed: false,
});

const notStarted = { ...NO_FACTS, activeTurn: false, firstTurn: false };

const WORKERS = new Map<string, WorkerFacts>(
  Object.entries({
    // Holds a slot it was granted 12m ago, no Turn ever.
    S1: { ...notStarted, slotHeldSince: ago(12) },
    // A restart just reacquired its slot.
    S2: { ...notStarted, slotHeldSince: ago(0.1) },
    S3: { ...notStarted, activity: { kind: "slot", host: null, since: ago(3) } },
    S4: { ...NO_FACTS, activeTurn: false, firstTurn: true, quietSince: ago(5) },
    S5: { ...notStarted, slotHeldSince: ago(0.1) },
  })
);

const facts = plainFacts({
  worker: (a) => WORKERS.get(a.taskId) ?? NO_FACTS,
  setup: (taskId) =>
    taskId === "S5" ? setup(taskId, setupRun(taskId, "running", 1)) : setup(taskId),
});

const rail = buildRail(record, facts);

const row = (id: string) =>
  rail.rows.find((r): r is TaskRow => r.kind === "task" && r.task.id === id);

describe("ENG-264: a worker row says where its startup is", () => {
  test("setup done, a slot held with no turn past a minute: stalled, needs you, with Start", () => {
    expect(row("S1")?.look).toMatchObject({
      word: "stalled · 12m",
      glyph: "needs-you",
      bucket: "needs-you",
      attention: { kind: "stalled" },
    });
    expect(row("S1")?.line).toMatchObject({
      kind: "note",
      text: "setup done · holds a slot, no turn yet",
    });
    expect(attentionItems(rail.tasks, facts).map((i) => i.text)).toContain(
      "S1 stalled · holds a slot, no turn yet"
    );
  });

  test("a freshly granted slot with no turn yet is starting, not stalled", () => {
    expect(row("S2")?.look).toMatchObject({ glyph: "waiting", bucket: "working", attention: null });
    expect(row("S2")?.look.word).toStartWith("starting · ");
    expect(row("S2")?.line).toMatchObject({ text: "setup done · starting its first turn" });
  });

  test("waiting for a slot, after its first turn, and setup still running stay distinct", () => {
    expect(row("S3")?.look.word).toBe("waiting · 3m");
    expect(row("S3")?.line).toMatchObject({ kind: "liveness", activity: "waiting for a slot" });
    expect(row("S4")?.line).toMatchObject({ kind: "liveness", idle: true });
    expect(row("S4")?.look.word).toBe("waiting · 5m");
    expect(row("S5")?.look.word).toBe("setting up");
  });
});
