import { describe, expect, test } from "bun:test";
import { attempt, constellationOf, task } from "../preview/graph.ts";
import { clock } from "./copy.ts";
import { NO_FACTS, plainFacts } from "./facts.ts";
import { buildRail } from "./rail.ts";
import { startedRecord } from "./fold.ts";
import type { TaskRow } from "./task.ts";

const RESET = "2026-10-11T14:00:00Z";

const record = startedRecord(
  constellationOf({
    tasks: [
      task({ id: "C1", title: "Capacity" }),
      task({ id: "C2", title: "Transport" }),
      task({ id: "C3", title: "Code" }),
      task({ id: "W1", title: "Idle worker" }),
    ],
    attempts: [
      attempt({
        taskId: "C1",
        state: "failed",
        minutes: 30,
        failure: { kind: "capacity", reason: "Selected model is at capacity", resetsAt: RESET },
      }),
      attempt({
        taskId: "C2",
        state: "failed",
        minutes: 30,
        failure: { kind: "transport", reason: "stream closed" },
      }),
      attempt({
        taskId: "C3",
        state: "failed",
        minutes: 30,
        failure: { kind: "implementation", reason: "tests failed" },
      }),
      attempt({ taskId: "W1", state: "working", minutes: 30 }),
    ],
  }),
  3
);

const rowsWith = (activeTurn: boolean | null) => {
  const facts = plainFacts({ worker: () => ({ ...NO_FACTS, activeTurn }) });

  return new Map(
    buildRail(record, facts)
      .rows.filter((r): r is TaskRow => r.kind === "task")
      .map((r) => [String(r.task.id), r])
  );
};

describe("F8: a failed settle names its kind", () => {
  const rows = rowsWith(null);

  test("a usage limit is neutral, with its reset on the second line", () => {
    const c1 = rows.get("C1");

    expect(c1?.look).toMatchObject({ word: "usage limit", wordTone: "neutral", glyph: "stopped" });
    expect(c1?.line).toMatchObject({
      text: `resets ${clock(RESET)}`,
      detail: "Selected model is at capacity",
    });
  });

  test("a connection failure is neutral; an implementation failure keeps the failed tone", () => {
    expect(rows.get("C2")?.look).toMatchObject({ word: "failed", wordTone: "neutral" });
    expect(rows.get("C2")?.line).toMatchObject({ text: "connection" });
    expect(rows.get("C3")?.look).toMatchObject({ word: "failed", wordTone: "failed" });
    expect(rows.get("C3")?.line).toMatchObject({ text: "implementation", detail: "tests failed" });
  });
});

describe("F9: no active Turn reads waiting, not working", () => {
  test("a working Attempt with no Turn in flight is waiting", () => {
    const w1 = rowsWith(false).get("W1");

    expect(w1?.look.word).toStartWith("waiting · ");
    expect(w1?.look.glyph).toBe("waiting");
    expect(w1?.line).toMatchObject({ kind: "liveness", idle: true });
  });

  test("an active Turn, or a Daemon that doesn't say, keeps working", () => {
    expect(rowsWith(true).get("W1")?.look.word).toStartWith("working · ");
    expect(rowsWith(null).get("W1")?.look.word).toStartWith("working · ");
  });
});
