import { expect, test } from "bun:test";
import { nextDigest } from "./schedule.ts";

const burst = (id: string, debounceMs = 2000) => ({ burst: id, debounceMs, ceilingMs: 20000 });

test("a new burst item restarts the debounce from now, capped at the window's start plus ceiling", () => {
  const first = nextDigest(undefined, burst("a"), 1000)!;
  expect(first).toEqual({ at: 3000, start: 1000, burst: "a" });
  expect(nextDigest(first, burst("a"), 2500)).toBeNull();
  expect(nextDigest(first, burst("b"), 2500)).toEqual({ at: 4500, start: 1000, burst: "b" });
  expect(nextDigest({ ...first, burst: "y" }, burst("z"), 20000)).toEqual({
    at: 21000,
    start: 1000,
    burst: "z",
  });
});

test("a blocking question is due now; a fixed wake only moves earlier and never anchors a burst", () => {
  expect(nextDigest(undefined, burst("q", 0), 500)!.at).toBe(500);
  const fixed = nextDigest(undefined, { burst: null, debounceMs: 5000, ceilingMs: 5000 }, 0)!;
  expect(nextDigest(fixed, { burst: null, debounceMs: 5000, ceilingMs: 5000 }, 1000)).toBeNull();
  expect(nextDigest(fixed, { burst: null, debounceMs: 1000, ceilingMs: 1000 }, 1000)!.at).toBe(
    2000
  );
  expect(nextDigest(fixed, burst("a"), 30000)).toEqual({ at: 32000, start: 30000, burst: "a" });
});
