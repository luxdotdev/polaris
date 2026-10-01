import { describe, expect, test } from "bun:test";
import {
  ReviewCheckout,
  ReviewCheckoutId,
  SessionId,
  TurnId,
  WorkspaceId,
} from "@polaris/protocol";
import { Data } from "effect";
import type { GitDiffSpec, ReviewSubject } from "@polaris/protocol";
import { emptyHostModel, type HostModel } from "../../../store/hostModel.ts";
import { checkoutsOf, pendingTurns, pullSource, sessionSource, type TurnInfo } from "./source.ts";

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
  const turn = (index: number): TurnInfo => ({
    id: TurnId.make(`t${index}`),
    index,
    prompt: index === 3 ? "" : `Do step ${index}\nwith details`,
    checkpointBefore: `b${index}`,
    checkpointAfter: index === 3 ? null : `a${index}`,
    status: index === 3 ? "working" : "completed",
  });

  const turns = [0, 1, 2, 3].map(turn);
  const session = { id: SessionId.make("s1"), cwd: "/ws", acceptedThroughIndex: 1 };

  test("shows the Turns since the last accept, one section each", () => {
    const source = sessionSource("h", session, turns, { kind: "all" });

    expect(source.sections.map((s) => [s.id, s.divider?.label, s.divider?.quote, s.next])).toEqual([
      ["t2", "Turn 3", "Do step 2", "a2"],
      ["t3", "Turn 4", null, null],
    ]);
    expect(source.sections[0]?.spec).toEqual(
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

    const done = turns.map((t) =>
      t.index === 3 ? { ...t, status: "completed", checkpointAfter: "a3" } : t
    );

    expect(sessionSource("h", session, done, { kind: "all" }).key).not.toBe(before);
  });
});
