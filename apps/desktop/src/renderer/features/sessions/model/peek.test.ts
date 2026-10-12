import { describe, expect, test } from "bun:test";
import { buildRail, tallyOf } from "../../constellation/model/index.ts";
import { plainFacts } from "../../constellation/model/facts.ts";
import { setupRecord } from "../../constellation/preview/setup.ts";
import { PEEK_ROWS, peekCounts, peekRows } from "./peek.ts";

const rail = buildRail(setupRecord(), plainFacts({}));

describe("the Space preview", () => {
  test("counts only the buckets with Tasks, in a fixed order", () => {
    const counts = peekCounts(tallyOf(rail.tasks));

    expect(counts.length).toBeGreaterThan(0);
    expect(counts.every((c) => !c.text.startsWith("0 "))).toBe(true);
    const order = ["done", "working", "review", "needs-you", "blocked", "waiting"];
    const seen = counts.map((c) => order.indexOf(c.bucket));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  test("lists Tasks still in play, needs you first, done ones left out", () => {
    const { shown, more } = peekRows(rail.tasks);
    const buckets = shown.map((t) => t.look.bucket);

    expect(buckets).not.toContain("done");

    if (buckets.includes("needs-you")) expect(buckets[0]).toBe("needs-you");
    expect(shown.length).toBeLessThanOrEqual(PEEK_ROWS);
    expect(shown.length + more).toBe(
      rail.tasks.filter((t) => t.look.bucket !== "done" && t.look.bucket !== "ended").length
    );
  });
});
