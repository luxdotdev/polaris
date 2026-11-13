import { expect, test } from "bun:test";
import { type OriginLineQuery, SessionId, TurnId } from "@polaris/protocol";
import { type FingerprintMatch, matchKey, resolveOrigins } from "./resolve.ts";

const s1 = SessionId.make("s1");

const s2 = SessionId.make("s2");

const t = (id: string) => TurnId.make(id);

const at = (sessionId: SessionId, turnId: string, time: number): FingerprintMatch => ({
  sessionId,
  turnId: t(turnId),
  at: time,
});

const line = (
  n: number,
  hash: string | null,
  commitSha: string | null = "c1",
  commitTime: number | null = 10_000
): OriginLineQuery => ({ line: n, path: "a.ts", hash, commitSha, commitTime });

const originsOf = (
  lines: ReadonlyArray<OriginLineQuery>,
  matches: Record<string, ReadonlyArray<FingerprintMatch>>
) =>
  Object.fromEntries(
    resolveOrigins(
      lines,
      new Map(Object.entries(matches).map(([hash, list]) => [matchKey(hash, "a.ts"), list]))
    ).map((l) => [l.line, l.origins])
  );

test("only Turns from before the line's commit count, within the commit's second", () => {
  const result = originsOf([line(1, "h", "c1", 10_000)], {
    h: [at(s1, "early", 9_000), at(s1, "same-second", 10_900), at(s2, "after", 11_000)],
  });

  expect(result[1]).toEqual([{ sessionId: s1, turnIds: [t("early"), t("same-second")] }]);
});

test("an uncommitted line matches Turns from any time", () => {
  const result = originsOf([line(1, "h", null, null)], { h: [at(s1, "late", 99_999)] });

  expect(result[1]).toEqual([{ sessionId: s1, turnIds: [t("late")] }]);
});

test("every matching session and every matching Turn of each is kept, oldest Turn first", () => {
  const result = originsOf([line(1, "h")], {
    h: [at(s1, "b", 2_000), at(s2, "x", 1_500), at(s1, "a", 1_000)],
  });

  expect(result[1]).toEqual([
    { sessionId: s1, turnIds: [t("a"), t("b")] },
    { sessionId: s2, turnIds: [t("x")] },
  ]);
});

test("a skipped line takes the nearest identified lines around it in its run", () => {
  const result = originsOf([line(1, "open"), line(2, null), line(3, null), line(4, "next")], {
    open: [at(s1, "t1", 1_000)],
    next: [at(s2, "t2", 1_000)],
  });

  expect(result[2]).toEqual([
    { sessionId: s1, turnIds: [t("t1")] },
    { sessionId: s2, turnIds: [t("t2")] },
  ]);
  expect(result[3]).toEqual(result[2]);
});

test("a skipped line next to a human line inherits nothing from it", () => {
  const result = originsOf([line(1, "human"), line(2, null)], {});

  expect(result[2]).toEqual([]);
});

test("a run ends at another commit or a gap in the lines", () => {
  const matches = { agent: [at(s1, "t1", 1_000)] };

  expect(originsOf([line(1, "agent", "c1"), line(2, null, "c2")], matches)[2]).toEqual([]);
  expect(originsOf([line(1, "agent"), line(3, null)], matches)[3]).toEqual([]);
});

test("a skipped line inherits only the Turns its neighbour's commit time allows", () => {
  const result = originsOf([line(1, "agent", "c1", 5_000), line(2, null, "c1", 5_000)], {
    agent: [at(s1, "before", 1_000), at(s1, "after", 9_000)],
  });

  expect(result[2]).toEqual([{ sessionId: s1, turnIds: [t("before")] }]);
});

test("lines come back in the order they were asked", () => {
  const lines = resolveOrigins([line(3, null), line(1, "a")], new Map());

  expect(lines.map((l) => l.line)).toEqual([3, 1]);
});

test("a fingerprint of the same line in another file is not this line's", () => {
  const matches = new Map([[matchKey("h", "b.ts"), [at(s1, "t1", 1_000)]]]);

  expect(resolveOrigins([line(1, "h")], matches)[0]?.origins).toEqual([]);
});
