import { describe, expect, test } from "bun:test";
import { buildRail } from "../../constellation/model/index.ts";
import { plainFacts } from "../../constellation/model/facts.ts";
import { setupRecord } from "../../constellation/preview/setup.ts";
import { peekCounts, peekRows } from "./peek.ts";

const rail = buildRail(setupRecord(), plainFacts({}));

describe("the Space preview", () => {
  test("counts only the buckets with Tasks, in a fixed order", () => {
    const counts = peekCounts({
      waiting: 3,
      "needs-you": 1,
      blocked: 0,
      review: 2,
      working: 0,
      done: 1,
      ended: 4,
      proposed: 0,
    });

    expect(counts.map((c) => c.text)).toEqual([
      "1 done",
      "2 in review",
      "1 needs you",
      "3 waiting",
    ]);
  });

  test("lists Tasks still in play, needs you first, done ones left out", () => {
    const tasks = rail.tasks.map((t) =>
      `${t.task.id}` === "G2" ? { ...t, look: { ...t.look, bucket: "needs-you" as const } } : t
    );

    const { shown, more } = peekRows(tasks);

    expect(shown.map((t) => `${t.task.id}`)).toEqual(["G2", "B1", "B4", "B2", "B3", "B5"]);
    expect(more).toBe(3);
  });
});
