import { describe, expect, test } from "bun:test";
import { ContextUsage } from "@polaris/protocol";
import type { HostModel } from "../../../store/hostModel.ts";
import { asPlain } from "../../../store/plain.ts";
import { C1, C2, HOSTS, MODELS, withSetupFailure } from "../../sessions/preview/fixtures.ts";
import { buildConstellationInbox, PRIORITY, withConstellations } from "./constellation.ts";
import { buildInbox, inboxKey } from "./inbox.ts";

const views = { local: [C1, C2] };

const inbox = buildConstellationInbox({ hosts: HOSTS, models: MODELS, views });

const kinds = (key: string) =>
  inbox.groups
    .find((g) => g.view.constellation.id === key)
    ?.items.map((i) => [`${i.taskId}`, i.kind]);

describe("buildConstellationInbox", () => {
  test("the spec's order: a worker's approval, a question, the lead, a silent end, context", () => {
    expect(PRIORITY).toEqual([
      "worker-approval",
      "question",
      "lead",
      "claim",
      "unclaimed",
      "setup",
      "stale",
      "worker-context",
      "lead-context",
    ]);
    expect(kinds("c2")).toEqual([
      ["L2", "worker-approval"],
      ["L1", "worker-context"],
    ]);
    expect(kinds("c1")).toEqual([
      ["B1", "question"],
      ["B5", "unclaimed"],
    ]);
  });

  test("groups go by their most urgent item", () => {
    expect(inbox.groups.map((g) => g.view.constellation.name)).toEqual([
      "Bench leases",
      "Constellations v1",
    ]);
  });

  test("the sessions shown here leave the plain inbox", () => {
    expect(inbox.sessions.has(inboxKey("local", "l2"))).toBe(true);
    expect(inbox.sessions.has(inboxKey("local", "glossary"))).toBe(false);
  });

  test("a paused Constellation's Claims wait on the user; a stale worker joins", () => {
    const paused = {
      ...C1,
      constellation: { ...C1.constellation, state: "paused" as const },
      projections: C1.projections.map((p) => (p.taskId === "B2" ? { ...p, stale: true } : p)),
    };

    const result = buildConstellationInbox({
      hosts: HOSTS,
      models: MODELS,
      views: { local: [paused] },
    });

    expect(result.groups[0]?.items.map((i) => [`${i.taskId}`, i.kind])).toEqual([
      ["B1", "question"],
      ["B4", "claim"],
      ["B1", "claim"],
      ["B5", "unclaimed"],
      ["B2", "stale"],
    ]);
  });

  test("a Claim the Lead hands up reaches the user while the Constellation runs", () => {
    const handed = {
      ...C1,
      constellation: {
        ...C1.constellation,
        attempts: C1.constellation.attempts.map((a) =>
          a.taskId === "B4" ? { ...asPlain(a), handedUpAt: "2026-10-01T10:00:00.000Z" } : a
        ),
      },
    };

    const result = buildConstellationInbox({
      hosts: HOSTS,
      models: MODELS,
      views: { local: [handed] },
    });

    expect(result.groups[0]?.items.map((i) => [`${i.taskId}`, i.kind])).toEqual([
      ["B1", "question"],
      ["B4", "claim"],
      ["B5", "unclaimed"],
    ]);
  });

  test("the lead near its limit offers a handover; completed Constellations are quiet", () => {
    const local = MODELS.local;
    const lead = local?.sessions.get("lead-c1");

    if (local === undefined || lead === undefined) throw new Error("the lead is in the fixtures");

    const full: HostModel = {
      ...local,
      sessions: new Map([
        ...local.sessions,
        [
          "lead-c1",
          {
            ...lead,
            session: {
              ...lead.session,
              contextUsage: new ContextUsage({ usedTokens: 360_000, windowTokens: 400_000 }),
            },
          },
        ],
      ]),
    };

    const models = { ...MODELS, local: full };
    const items = buildConstellationInbox({ hosts: HOSTS, models, views: { local: [C1] } });

    expect(items.groups[0]?.items.at(-1)?.kind).toBe("lead-context");

    const done = { ...C1, constellation: { ...C1.constellation, state: "completed" as const } };

    expect(
      buildConstellationInbox({ hosts: HOSTS, models, views: { local: [done] } }).groups
    ).toEqual([]);
  });
});

test("a failed worktree setup on another Host joins its Lead's group, after a silent end", () => {
  const { models, view } = withSetupFailure();

  const result = buildConstellationInbox({ hosts: HOSTS, models, views: { local: [view] } });
  const items = result.groups[0]?.items ?? [];

  expect(items.map((i) => [`${i.taskId}`, i.kind])).toEqual([
    ["B1", "question"],
    ["B5", "unclaimed"],
    ["B6", "setup"],
  ]);
  expect(items.at(-1)?.setup?.remoteHost).toBe("devbox");
  expect(result.sessions.has(inboxKey("devbox", "b6"))).toBe(true);

  // The run isn't in this graph: nothing joins.
  expect(
    buildConstellationInbox({ hosts: HOSTS, models, views: { local: [C1] } }).groups[0]?.items.map(
      (i) => i.kind
    )
  ).toEqual(["question", "unclaimed"]);
});

test("the count covers Constellation items once, beside sessions that need you", () => {
  const plain = buildInbox({
    hosts: HOSTS,
    models: MODELS,
    now: Date.now(),
    answeredHere: new Set(),
  });

  // L2 needs you as a session already; L1's context, B1's question and B5's silent end add three.
  expect(plain.count).toBe(1);
  expect(withConstellations(plain, inbox).count).toBe(4);
  expect(withConstellations(plain, inbox).waiting.length).toBe(plain.waiting.length);
});

test("a blocked worker waits on work or the Lead, not on you: no item, even nudged", () => {
  const graph = asPlain(C1.constellation);
  const nudgedAt = new Date(Date.now() - 600_000).toISOString();

  const nudged = {
    projections: C1.projections,
    constellation: {
      ...graph,
      attempts: graph.attempts.map((a) =>
        a.state === "blocked" ? { ...asPlain(a), nudgedAt } : a
      ),
    },
  };

  const blocked = buildConstellationInbox({
    hosts: HOSTS,
    models: MODELS,
    views: { local: [nudged] },
  });

  const ids = blocked.groups.flatMap((g) => g.items.map((i) => `${i.taskId}`));

  expect(ids).not.toContain("F2");
  expect(ids).not.toContain("F3");
  expect(ids).toEqual(["B1", "B5"]);
});
