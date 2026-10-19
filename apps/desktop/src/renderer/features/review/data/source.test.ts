import { describe, expect, test } from "bun:test";
import {
  ReviewCheckout,
  ReviewCheckoutId,
  SessionId,
  type Turn,
  TurnId,
  TurnTrigger,
  WorkspaceId,
} from "@polaris/protocol";
import { Data, Predicate } from "effect";
import type { GitDiffSpec, ReviewSubject } from "@polaris/protocol";
import { turnWith } from "../../../store/fixtures.testing.ts";
import { emptyHostModel, type HostModel } from "../../../store/hostModel.ts";
import type { TurnView } from "../../../store/sessionModel.ts";
import {
  checkoutsOf,
  type DiffSource,
  pendingTurns,
  pickerOptions,
  pullSource,
  reviewTurns,
  sessionSource,
  turnRange,
} from "./source.ts";

const Subjects = Data.taggedEnum<ReviewSubject>();

const Specs = Data.taggedEnum<GitDiffSpec>();

const PULL = { repo: { owner: "Acme", name: "widgets" }, number: 42, pullId: "PR_42" };

const checkout = (id: string, patch: Partial<ReviewCheckout> = {}) =>
  new ReviewCheckout({
    id: ReviewCheckoutId.make(id),
    workspaceId: WorkspaceId.make("w1"),
    subject: Subjects.PullRequest({
      pullRequest: { repo: { host: "github.com", owner: "acme", name: "widgets" }, number: 42 },
      baseRef: "main",
    }),
    path: `/repo/.review/pr-42`,
    state: "ready",
    blocked: null,
    head: "h1",
    mergeBase: "b1",
    latestHead: "h1",
    latestBase: "b0",
    reviewedHead: null,
    reviewedMergeBase: null,
    openedAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...patch,
  });

const models = (
  entries: Record<string, ReadonlyArray<ReviewCheckout>>
): Record<string, HostModel> =>
  Object.fromEntries(
    Object.entries(entries).map(([key, list]) => [
      key,
      { ...emptyHostModel, reviewCheckouts: new Map(list.map((c) => [c.id, c])) },
    ])
  );

describe("pullSource", () => {
  test("diffs a ready checkout from its merge base to its head, on its Host", () => {
    const state = pullSource(PULL, models({ studio: [checkout("c1")] }), []);

    expect(state.kind).toBe("ready");

    if (state.kind !== "ready") return;

    expect(state.source).toMatchObject({ hostKey: "studio", cwd: "/repo/.review/pr-42" });
    expect(state.source.sections[0]?.spec).toEqual(Specs.Range({ base: "b1", head: "h1" }));
  });

  test("keeps the last diff while an update fetches; waits for a first fetch", () => {
    const updating = pullSource(PULL, models({ s: [checkout("c1", { state: "fetching" })] }), []);

    expect(updating.kind).toBe("ready");

    const first = pullSource(
      PULL,
      models({ s: [checkout("c1", { state: "fetching", head: null, mergeBase: null })] }),
      []
    );

    expect(first).toMatchObject({ kind: "waiting", wait: { kind: "fetching", hostKey: "s" } });
  });

  test("a blocked first fetch is a failure; no checkout offers the places", () => {
    const blocked = checkout("c1", {
      state: "blocked",
      head: null,
      mergeBase: null,
    });

    expect(pullSource(PULL, models({ s: [blocked] }), [])).toMatchObject({
      wait: { kind: "failed" },
    });
    expect(pullSource(PULL, models({}), [{ hostKey: "s", workspaceId: "w1" }])).toMatchObject({
      wait: { kind: "none", hosts: [{ hostKey: "s" }] },
    });
  });

  test("matches the repository case-insensitively and ignores other pull requests", () => {
    const other = checkout("c2", {
      subject: Subjects.PullRequest({
        pullRequest: { repo: { host: "github.com", owner: "acme", name: "widgets" }, number: 7 },
        baseRef: "main",
      }),
    });

    expect(
      checkoutsOf(PULL, models({ a: [other], b: [checkout("c1")] })).map((c) => c.hostKey)
    ).toEqual(["b"]);
  });
});

describe("sessionSource", () => {
  const continued = TurnTrigger.cases.BackgroundTasksReported.make({ tasks: [] });

  const view = (index: number, patch: Partial<Turn> = {}): TurnView => ({
    turn: turnWith({
      id: TurnId.make(`t${index}`),
      index,
      prompt: index === 3 ? "" : `Do step ${index}\nwith details`,
      checkpointBefore: `b${index}`,
      checkpointAfter: index === 3 ? null : `a${index}`,
      status: index === 3 ? "working" : "completed",
      ...patch,
    }),
    items: [],
    live: new Map(),
    subagents: [],
  });

  const turns = reviewTurns([0, 1, 2, 3].map((i) => view(i)));

  const session = {
    id: SessionId.make("s1"),
    cwd: "/ws",
    harness: "claude",
    acceptedThroughIndex: 1,
  };

  const rows = (source: DiffSource) =>
    source.sections.map((s) => [s.id, s.divider?.turn, s.divider?.quote, s.base, s.next]);

  test("shows the Turns since the last accept, newest first, one section each", () => {
    const source = sessionSource("h", session, turns, { kind: "all" });

    expect(rows(source)).toEqual([
      ["t3", 4, null, "b3", null],
      ["t2", 3, "Do step 2", "b2", "a2"],
    ]);
    expect(source.sections[1]?.spec).toEqual(
      Specs.Turn({ sessionId: session.id, turnId: TurnId.make("t2") })
    );
  });

  test("one picked Turn; every Turn once all are accepted", () => {
    expect(
      sessionSource("h", session, turns, { kind: "turn", turnId: TurnId.make("t0") }).sections
    ).toHaveLength(1);
    expect(pendingTurns(turns, 3)).toHaveLength(4);
  });

  test("the key follows a Turn's status and checkpoint", () => {
    const before = sessionSource("h", session, turns, { kind: "all" }).key;
    const done = reviewTurns([0, 1, 2, 3].map((i) => view(i, { checkpointAfter: `a${i}` })));

    expect(sessionSource("h", session, done, { kind: "all" }).key).not.toBe(before);
  });

  describe("a Turn the Harness continued", () => {
    // t0 user, t1 Harness-started, t2 user, t3 Harness-started (still working).
    const merged = reviewTurns([
      view(0, { userTurnNumber: 1 }),
      view(1, { userTurnNumber: 1, trigger: continued }),
      view(2, { userTurnNumber: 2 }),
      view(3, { userTurnNumber: 2, trigger: continued }),
    ]);

    const fresh = { ...session, acceptedThroughIndex: null };

    test("is one section and one divider, from its first Turn's checkpoint to its last's", () => {
      const source = sessionSource("h", fresh, merged, { kind: "all" });

      expect(rows(source)).toEqual([
        ["t2", 2, "Do step 2", "b2", null],
        ["t0", 1, "Do step 0", "b0", "a1"],
      ]);
      expect(source.sections[1]?.spec).toEqual(
        Specs.Turns({
          sessionId: session.id,
          firstTurnId: TurnId.make("t0"),
          lastTurnId: TurnId.make("t1"),
        })
      );
    });

    test("the picker offers one entry per Turn", () => {
      expect(pickerOptions(pendingTurns(merged, null))).toEqual([
        { value: "t0", label: "1" },
        { value: "t2", label: "2" },
        { value: "all", label: "All 2 turns" },
      ]);
      expect(turnRange(merged)).toBe("turns 1–2");
    });

    test("accepted partway, it shows only what came after, under its own number", () => {
      const partway = { ...session, acceptedThroughIndex: 0 };
      const source = sessionSource("h", partway, merged, { kind: "all" });

      expect(rows(source).at(-1)).toEqual(["t1", 1, "Do step 0", "b1", "a1"]);
    });

    test("without git.diff-turns, each Turn it ran is a section under the same number", () => {
      const source = sessionSource("h", fresh, merged, { kind: "all" }, false);

      expect(source.sections.map((s) => [s.id, s.divider?.turn])).toEqual([
        ["t3", 2],
        ["t2", 2],
        ["t1", 1],
        ["t0", 1],
      ]);
      expect(source.sections.every((s) => Predicate.isTagged(s.spec, "Turn"))).toBe(true);
    });
  });
});
