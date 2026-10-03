import { describe, expect, test } from "bun:test";
import { activeSessions } from "../../../routes/topBar.ts";
import { sessionOrder } from "../../../routes/selection.ts";
import { type Attempt, SessionId, TaskId, WorktreeSetupRun } from "@polaris/protocol";
import { asPlain, type Plain } from "../../../store/plain.ts";
import { C1, C2, C3, HOSTS, MODELS, withSetupFailure } from "../preview/fixtures.ts";
import {
  doneLine,
  idsOnly,
  leadLine,
  lookupIn,
  type LeadWorker,
  setupLookupIn,
  sidebarItems,
  workerRows,
  workerSections,
  workerState,
} from "./leadGroups.ts";

const lookup = lookupIn(HOSTS, MODELS);

const setups = setupLookupIn(HOSTS, MODELS);

const local = MODELS.local;

if (local === undefined) throw new Error("fixtures have a local Host");

const entries = [...activeSessions(local)].sort(sessionOrder);

describe("workerRows", () => {
  test("one row per Task tried, Gates left to the Lead, loudest first", () => {
    const rows = workerRows(C1, lookup);

    expect(rows.map((r) => [`${r.taskId}`, r.state])).toEqual([
      ["B5", "unclaimed"],
      ["B1", "review"],
      ["B4", "review"],
      ["B2", "working"],
      ["B3", "waiting-slot"],
      ["F1b", "working"],
      ["F2", "blocked"],
      ["F3", "blocked"],
      ["A1", "accepted"],
      ["A2", "accepted"],
      ["F1a", "accepted"],
    ]);
  });

  test("a worker queued for a slot on its Host says since when", () => {
    const b3 = workerRows(C1, lookup).find((r) => r.taskId === "B3");

    expect(b3?.slotSince).not.toBeNull();
    expect(workerRows(C1, lookup).find((r) => r.taskId === "B2")?.slotSince).toBeNull();
  });

  test("a remote worker is found on its own Host; its branch may not be back yet", () => {
    const b4 = workerRows(C1, lookup).find((r) => r.taskId === "B4");

    expect(b4?.hostKey).toBe("devbox");
    expect(`${b4?.entry?.session.id}`).toBe("b4");
    expect(b4?.fetched).toBe(false);
  });

  test("a pending approval outranks the Attempt's state", () => {
    expect(workerRows(C2, lookup).map((r) => [`${r.taskId}`, r.state])).toEqual([
      ["L2", "needs-you"],
      ["L1", "working"],
      ["L3", "working"],
    ]);
  });
});

describe("workerState", () => {
  const found = C1.constellation.attempts.find((a) => a.taskId === "B2");

  if (found === undefined) throw new Error("B2 has an Attempt");
  const attempt: Plain<Attempt> = { ...asPlain(found) };

  test("stale wins over working, never settles it", () => {
    expect(workerState(attempt, null, true)).toBe("stale");
    expect(workerState({ ...attempt, state: "review" }, null, true)).toBe("stale");
  });

  test("an idle worker is stopped only after its one nudge", () => {
    const idle = MODELS.local.sessions.get("b5") ?? null;

    expect(workerState({ ...attempt, nudgedAt: null }, idle, false)).toBe("working");
    expect(workerState({ ...attempt, nudgedAt: "2026-10-01T10:00:00.000Z" }, idle, false)).toBe(
      "unclaimed"
    );
  });

  test("a worker whose nudged Turn is still running is not stopped", () => {
    const idle = MODELS.local.sessions.get("b5") ?? null;
    const later = new Date(Date.now() + 60_000).toISOString();

    expect(workerState({ ...attempt, nudgedAt: later }, idle, false)).toBe("working");
  });

  test("a Claim the Lead hands up is the user's until they approve it", () => {
    const review = { ...attempt, state: "review" as const, handedUpAt: "2026-10-01T10:00:00.000Z" };

    expect(workerState(review, null, false)).toBe("handed-up");
    expect(
      workerState({ ...review, approvedByUserAt: "2026-10-01T10:05:00.000Z" }, null, false)
    ).toBe("review");
  });

  test("settled outcomes", () => {
    expect(workerState({ ...attempt, state: "rejected" }, null, false)).toBe("sent-back");
    expect(workerState({ ...attempt, state: "settled_unverified" }, null, false)).toBe(
      "unverified"
    );
  });
});

describe("sidebarItems", () => {
  const { items, constellations } = sidebarItems({
    hostKey: "local",
    entries,
    views: [C1, C2, C3],
    lookup,
    setups,
  });

  test("workers leave the plain list and nest under their Lead", () => {
    const plain = items.flatMap((i) => (i.kind === "session" ? [`${i.entry.session.id}`] : []));

    expect(plain).toEqual(["glossary"]);
    expect(constellations).toBe(3);
  });

  test("a Lead's workers group by task.group, the group that needs you first", () => {
    const c3 = items
      .flatMap((i) => (i.kind === "lead" ? [i.group] : []))
      .find((g) => g.view === C3);

    const sections = workerSections(c3?.workers ?? []);

    expect(sections.map((s) => [s.label, s.rows.map((r) => `${r.taskId}`), s.needsYou])).toEqual([
      ["daemon", ["worktree-setup-retry-on-reconnect", "handoff-hardening"], 1],
      ["desktop", ["email-validator"], 0],
    ]);
    expect(c3?.done.map((r) => `${r.taskId}`)).toEqual(["sidebar-groups", "tab-lanes"]);
  });

  test("a Lead with slug ids shows ids alone; short ids keep their titles", () => {
    const groups = items.flatMap((i) => (i.kind === "lead" ? [i.group] : []));

    const shown = new Map(groups.map((g) => [g.view.constellation.name, idsOnly(g)]));

    expect(shown.get("Constellations v1")).toBe(false);
    expect(shown.get("Bench leases")).toBe(false);
    expect(shown.get("Release polish")).toBe(true);
  });

  test("a Lead counts what needs you, itself included", () => {
    const groups = items.flatMap((i) => (i.kind === "lead" ? [i.group] : []));
    const c1 = groups.find((g) => g.view === C1);
    const c2 = groups.find((g) => g.view === C2);

    expect(c1?.needsYou).toBe(1);
    expect(c2?.needsYou).toBe(1);
    expect(c1?.done.map((r) => `${r.taskId}`)).toEqual(["A1", "A2", "F1a"]);
    expect(c1 === undefined ? null : leadLine(c1)).toEqual({
      workers: "11 workers",
      needsYou: "1 needs you",
    });
  });

  test("an archived Constellation's Lead is a plain session again", () => {
    const archived = {
      ...C2,
      constellation: { ...C2.constellation, state: "archived" as const },
    };

    const result = sidebarItems({
      hostKey: "local",
      entries,
      views: [archived],
      lookup,
      setups,
    });

    expect(result.constellations).toBe(0);
    expect(result.items.every((i) => i.kind === "session")).toBe(true);
  });
});

describe("worktree setup before the first Attempt", () => {
  const failure = withSetupFailure();
  const b5 = failure.models.local.sessions.get("b5");

  if (b5 === undefined) throw new Error("b5 is in the fixtures");

  // B7's setup runs on this Mac: its Session is Dormant, which the sidebar must never say.
  const b7 = {
    ...b5,
    session: {
      ...asPlain(b5.session),
      id: SessionId.make("b7"),
      title: "B7 · Bench wrapper",
      state: "dormant" as const,
      worktreeSetup: new WorktreeSetupRun({
        id: "d7:setup:1",
        constellationId: C1.constellation.id,
        taskId: TaskId.make("B7"),
        command: "bun install",
        cwd: "/Users/lucas/code/polaris.worktrees/B7",
        status: "running",
        output: "",
        exitCode: null,
        startedAt: new Date().toISOString(),
        endedAt: null,
      }),
    },
  };

  const models = {
    ...failure.models,
    local: {
      ...failure.models.local,
      sessions: new Map([...failure.models.local.sessions, ["b7", b7]]),
    },
  };

  const task = failure.view.constellation.tasks.find((t) => t.id === "B6");

  if (task === undefined) throw new Error("B6 is in the fixture");

  const view = {
    ...failure.view,
    constellation: {
      ...failure.view.constellation,
      tasks: [...failure.view.constellation.tasks, { ...asPlain(task), id: TaskId.make("B7") }],
    },
  };

  const localEntries = [...activeSessions(models.local)].sort(sessionOrder);

  const result = sidebarItems({
    hostKey: "local",
    entries: localEntries,
    views: [view, C2, C3],
    lookup: lookupIn(HOSTS, models),
    setups: setupLookupIn(HOSTS, models),
  });

  const group = result.items
    .flatMap((i) => (i.kind === "lead" ? [i.group] : []))
    .find((g) => g.view === view);

  test("setup workers nest under their Lead, failed ones needing you, across Hosts", () => {
    expect(group?.workers.map((r) => [`${r.taskId}`, r.kind, r.state])).toEqual([
      ["B5", "attempt", "unclaimed"],
      ["B6", "setup", "setup-failed"],
      ["B1", "attempt", "review"],
      ["B4", "attempt", "review"],
      ["B2", "attempt", "working"],
      ["B3", "attempt", "waiting-slot"],
      ["F1b", "attempt", "working"],
      ["F2", "attempt", "blocked"],
      ["F3", "attempt", "blocked"],
      ["B7", "setup", "setting-up"],
    ]);
    expect(group?.needsYou).toBe(2);
  });

  test("a setting-up worker's Session leaves the plain list", () => {
    const plain = result.items.flatMap((i) =>
      i.kind === "session" ? [`${i.entry.session.id}`] : []
    );

    expect(plain).toEqual(["glossary"]);
  });
});

test("doneLine names a few, then counts", () => {
  const rows = workerRows(C1, lookup).filter((r) => r.state === "accepted");

  expect(doneLine(rows)).toBe("A1, A2, F1a done");
  expect(doneLine([...rows, ...rows])).toBe("A1, A2, F1a and 3 more done");
});

describe("workerSections", () => {
  const row = (taskId: string, group: string | null, state: LeadWorker["state"]): LeadWorker => {
    const base = workerRows(C1, lookup)[0];

    if (base === undefined) throw new Error("C1 has workers");

    return { ...base, taskId: TaskId.make(taskId), group, state };
  };

  test("ungrouped workers lead without a heading, then groups by their loudest worker", () => {
    const sections = workerSections([
      row("a", "desktop", "needs-you"),
      row("b", null, "working"),
      row("c", "daemon", "review"),
      row("d", "desktop", "working"),
    ]);

    expect(sections.map((s) => [s.label, s.rows.map((r) => `${r.taskId}`)])).toEqual([
      [null, ["b"]],
      ["desktop", ["a", "d"]],
      ["daemon", ["c"]],
    ]);
  });

  test("no workers, no sections", () => {
    expect(workerSections([])).toEqual([]);
  });
});

describe("parents in the sidebar", () => {
  const rows = workerRows(C1, lookup).filter((r) => r.state !== "accepted");
  const updates = workerSections(rows).find((s) => s.label === "F · Updates");

  test("workers nest under their parents, loudest subtree first", () => {
    expect(
      updates?.items.map((i) =>
        i.kind === "parent" ? [`${i.parent.id}`, i.depth, i.blocked] : [`${i.row.taskId}`, i.depth]
      )
    ).toEqual([
      ["F", 0, 2],
      ["F1", 1, 0],
      ["F1b", 2],
      ["F2", 1],
      ["F3", 1],
    ]);
  });

  test("a blocked worker reads blocked, unless its session needs you", () => {
    const f2 = rows.find((r) => r.taskId === "F2");

    expect(f2?.state).toBe("blocked");
    expect(f2?.group).toBe("F · Updates");
    expect(f2?.parents.map((p) => `${p.id}`)).toEqual(["F"]);
  });
});
