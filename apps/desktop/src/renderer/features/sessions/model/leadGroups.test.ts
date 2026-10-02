import { describe, expect, test } from "bun:test";
import { activeSessions } from "../../../routes/topBar.ts";
import { sessionOrder } from "../../../routes/selection.ts";
import type { Attempt } from "@polaris/protocol";
import { asPlain, type Plain } from "../../../store/plain.ts";
import { C1, C2, HOSTS, MODELS } from "../preview/fixtures.ts";
import {
  doneLine,
  leadLine,
  lookupIn,
  sidebarItems,
  workerRows,
  workerState,
} from "./leadGroups.ts";

const lookup = lookupIn(HOSTS, MODELS);

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
      ["A1", "accepted"],
      ["A2", "accepted"],
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
    views: [C1, C2],
    lookup,
  });

  test("workers leave the plain list and nest under their Lead", () => {
    const plain = items.flatMap((i) => (i.kind === "session" ? [`${i.entry.session.id}`] : []));

    expect(plain).toEqual(["glossary"]);
    expect(constellations).toBe(2);
  });

  test("a Lead counts what needs you, itself included", () => {
    const groups = items.flatMap((i) => (i.kind === "lead" ? [i.group] : []));
    const c1 = groups.find((g) => g.view === C1);
    const c2 = groups.find((g) => g.view === C2);

    expect(c1?.needsYou).toBe(1);
    expect(c2?.needsYou).toBe(1);
    expect(c1?.done.map((r) => `${r.taskId}`)).toEqual(["A1", "A2"]);
    expect(c1 === undefined ? null : leadLine(c1)).toEqual({
      workers: "7 workers",
      needsYou: "1 needs you",
    });
  });

  test("an archived Constellation's Lead is a plain session again", () => {
    const archived = {
      ...C2,
      constellation: { ...C2.constellation, state: "archived" as const },
    };

    const result = sidebarItems({ hostKey: "local", entries, views: [archived], lookup });

    expect(result.constellations).toBe(0);
    expect(result.items.every((i) => i.kind === "session")).toBe(true);
  });
});

test("doneLine names a few, then counts", () => {
  const rows = workerRows(C1, lookup).filter((r) => r.state === "accepted");

  expect(doneLine(rows)).toBe("A1, A2 done");
  expect(doneLine([...rows, ...rows, ...rows])).toBe("A1, A2, A1 and 3 more done");
});
