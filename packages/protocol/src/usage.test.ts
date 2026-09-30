import { expect, test } from "bun:test";
import { SessionId } from "./ids.ts";
import { TokenCounts, UsageBucket, usageShare } from "./usage.ts";

const bucket = (sessionId: string | null, output: number) =>
  new UsageBucket({
    hour: "2026-09-01T10:00:00Z",
    harness: "claude",
    model: "claude-opus-5-5",
    sessionId: sessionId === null ? null : SessionId.make(sessionId),
    tokens: new TokenCounts({
      input: 1,
      cacheRead: 2,
      cacheWrite: 3,
      output,
      reasoning: 0,
      cacheWrite1h: 1,
    }),
    reportedCost: null,
    longContext: [],
  });

test("usageShare splits the tokens Polaris drove from all of them", () => {
  const share = usageShare([bucket("s1", 10), bucket(null, 30), bucket("s2", 5)]);

  expect(share.all.output).toBe(45);
  expect(share.polaris.output).toBe(15);
  expect(share.polaris.input).toBe(2);
  expect(share.all.cacheWrite1h).toBe(3);
  expect(usageShare([]).all.output).toBe(0);
});
