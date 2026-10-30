import { describe, expect, test } from "bun:test";
import { BackgroundTask, SessionId } from "@polaris/protocol";
import { hostModel } from "../../../routes/fixtures.testing.ts";
import { approval } from "../../../store/fixtures.testing.ts";
import type { SessionEntry } from "../../../store/hostModel.ts";
import type { SessionData } from "../../../store/plain.ts";
import type { WorkerState } from "./leadGroups.ts";
import { byTier, groupTierOf, heldOrder, tierOf, tierRuns } from "./tiers.ts";

const base = [
  ...hostModel([{ id: "w", sessions: [{ id: "x", state: "idle" }] }]).sessions.values(),
][0]!;

const entry = (id: string, fields: Partial<SessionData> = {}): SessionEntry => ({
  ...base,
  session: { ...base.session, id: SessionId.make(id), title: id, ...fields },
});

const ids = (entries: ReadonlyArray<SessionEntry>) => entries.map((e) => `${e.session.id}`);

const group = (lead: SessionEntry, needsYou: number, workers: ReadonlyArray<WorkerState>) => ({
  lead,
  needsYou,
  workers: workers.map((state) => ({ state })),
});

describe("tierOf", () => {
  test.each([
    [
      "a pending approval on a working session",
      { ...entry("a", { state: "working" }), pendingApprovals: [approval] },
      "needs-you",
    ],
    ["a failed session", entry("a", { state: "failed" }), "needs-you"],
    ["a session at its usage limit", entry("a", { state: "limited" }), "needs-you"],
    ["a starting session", entry("a", { state: "starting" }), "working"],
    [
      "an idle session waiting on a subagent",
      entry("a", {
        backgroundTasks: [new BackgroundTask({ id: "t", kind: "subagent", description: "x" })],
      }),
      "working",
    ],
    ["a plain idle session", entry("a"), "idle"],
    ["a dormant session", entry("a", { state: "dormant" }), "dormant"],
  ] as const)("%s", (_, e, tier) => {
    expect(tierOf(e)).toBe(tier);
  });
});

describe("byTier", () => {
  test("needs you, working, idle, dormant, each keeping its incoming order", () => {
    const rows = [
      entry("idle-new"),
      entry("dormant", { state: "dormant" }),
      entry("work-new", { state: "working" }),
      entry("idle-old"),
      entry("needs", { state: "needs-you" }),
      entry("work-old", { state: "working" }),
    ];

    expect(ids(byTier(rows, tierOf))).toEqual([
      "needs",
      "work-new",
      "work-old",
      "idle-new",
      "idle-old",
      "dormant",
    ]);
  });
});

describe("groupTierOf", () => {
  const idleLead = entry("lead");

  test("a worker that needs you lifts an idle Lead to needs you", () => {
    expect(groupTierOf(group(idleLead, 1, ["working"]))).toBe("needs-you");
  });

  test("a working or setting-up worker makes an idle Lead working", () => {
    expect(groupTierOf(group(idleLead, 0, ["accepted", "setting-up"]))).toBe("working");
  });

  test("a finished constellation reads as its Lead does", () => {
    const dormantLead = entry("lead", { state: "dormant" });

    expect(groupTierOf(group(dormantLead, 0, ["review", "blocked"]))).toBe("dormant");
  });
});

describe("tierRuns", () => {
  test("splits rows into one run per tier for the dividers", () => {
    const rows = [entry("w", { state: "working" }), entry("i1"), entry("i2")];

    expect(tierRuns(rows, tierOf).map((r) => [r.tier, ids(r.items)])).toEqual([
      ["working", ["w"]],
      ["idle", ["i1", "i2"]],
    ]);
  });
});

describe("heldOrder", () => {
  const key = (s: string) => s;

  test("rows keep their held places when the live order changes; new ones go last", () => {
    expect(heldOrder(["c", "new", "a", "b"], key, ["a", "b", "c"])).toEqual(["a", "b", "c", "new"]);
  });

  test("nothing held shows the live order", () => {
    expect(heldOrder(["c", "a"], key, null)).toEqual(["c", "a"]);
  });
});
