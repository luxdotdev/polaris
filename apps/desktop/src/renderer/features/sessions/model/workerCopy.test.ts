import { describe, expect, test } from "bun:test";
import { HOSTS, MODELS, C1 } from "../preview/fixtures.ts";
import { lookupIn, type WorkerRow, workerRows } from "./leadGroups.ts";
import { shownWorker } from "./workerCopy.ts";

const b2 = workerRows(C1, lookupIn(HOSTS, MODELS)).find(
  (r): r is WorkerRow => r.kind === "attempt" && r.taskId === "B2"
);

if (b2 === undefined) throw new Error("C1 has B2");

const failed = (failureKind: WorkerRow["attempt"]["failureKind"], resetsAt: string | null) => ({
  ...b2,
  state: "failed" as const,
  attempt: { ...b2.attempt, failureKind, resetsAt },
});

describe("shownWorker", () => {
  test("a usage limit reads neutral with its reset, never red failed", () => {
    expect(shownWorker(failed("capacity", null))).toEqual({
      glyph: "stopped",
      word: "Usage limit · reset time unknown",
      tone: "subtle",
    });
  });

  test("a connection failure is neutral too", () => {
    expect(shownWorker(failed("transport", null)).tone).toBe("subtle");
  });

  test("the worker's own failure, or an unknown one, stays failed", () => {
    expect(shownWorker(failed("implementation", null)).tone).toBe("failed");
    expect(shownWorker(failed(null, null))).toEqual({
      glyph: "failed",
      word: "failed",
      tone: "failed",
    });
  });
});
