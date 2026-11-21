import { describe, expect, test } from "bun:test";
import { TaskId } from "@polaris/protocol";
import { Predicate } from "effect";
import { A, B, CID } from "../../engine/constellation.testing.ts";
import { foldLogbook } from "./fold.ts";
import {
  D,
  DEPENDENT,
  PEER,
  RETRY,
  STRANGER,
  Story,
  WORKER,
  as,
  lead,
  story,
  user,
} from "./logbook.testing.ts";
import { logbookRefusal } from "./page.ts";

/** In the story's end state: A is accepted, B is lost, and D (which depends on A) is working. */
const reads = (binding: Parameters<typeof logbookRefusal>[0], taskId?: typeof A) =>
  logbookRefusal(binding, story().record, { constellationId: CID, taskId })?.code ?? "read";

describe("who writes a Task's Logbook", () => {
  test("the Task's current Attempt, the Lead and the user, each under its own role", () => {
    const s = story();

    expect(s.note(D, "From the worker", as(DEPENDENT))).toEqual([]);
    expect(s.note(D, "From the Lead", lead)).toEqual([]);
    expect(s.note(D, "From the user", user)).toEqual([]);

    const notes = foldLogbook(s.envelopes).entries.filter(
      (e) => Predicate.isTagged(e, "Note") && e.taskId === D
    );

    expect(notes.map((e) => [e.author, e.text, e.attempt])).toEqual([
      ["worker", "From the worker", 1],
      ["lead", "From the Lead", 1],
      ["you", "From the user", 1],
    ]);
  });

  test.each([
    ["another Task's worker", as(DEPENDENT), A],
    ["an Attempt that was sent back", as(WORKER), A],
    ["an Attempt that was accepted", as(RETRY), A],
    ["an Attempt that was lost", as(PEER), B],
    ["a session outside the Constellation", as(STRANGER), D],
  ])("%s is refused and nothing is recorded", (_who, binding, taskId) => {
    const s = story();
    const before = s.envelopes.length;

    expect(s.note(taskId, "Not mine to write", binding)).toEqual(["E-AUTHORITY"]);
    expect(s.envelopes).toHaveLength(before);
  });

  test("a note on a Task that doesn't exist is refused, also for the user", () => {
    expect(story().note(TaskId.make("Z"), "Nowhere", user)).toEqual(["E-TASK-UNKNOWN"]);
  });

  test("before a Task's first Attempt, the Lead's note is filed under no Attempt", () => {
    const s = new Story();

    expect(s.note(A, "Start from main.", lead)).toEqual([]);
    expect(s.note(A, "Not started", as(WORKER))).toEqual(["E-AUTHORITY"]);

    const [note] = foldLogbook(s.envelopes).entries.filter((e) => Predicate.isTagged(e, "Note"));

    expect([note?.author, note?.attemptId, note?.attempt]).toEqual(["lead", null, null]);
  });
});

describe("who reads a Task's Logbook", () => {
  test.each([
    ["its own worker", as(DEPENDENT), D, "read"],
    ["the worker of a Task that depends on it", as(DEPENDENT), A, "read"],
    ["the Lead", lead, A, "read"],
    ["the user", user, B, "read"],
    ["a worker whose Task doesn't depend on it", as(DEPENDENT), B, "E-AUTHORITY"],
    ["a worker whose Attempt has ended", as(RETRY), A, "E-AUTHORITY"],
    ["a session outside the Constellation", as(STRANGER), A, "E-AUTHORITY"],
  ])("%s", (_who, binding, taskId, outcome) => {
    expect(reads(binding, taskId)).toBe(outcome);
  });

  test("a dependency's worker doesn't read the Logbook of the Task that depends on it", () => {
    const s = new Story();
    s.dispatch(A, "a1", WORKER);

    const code = (taskId: typeof A) =>
      logbookRefusal(as(WORKER), s.record, { constellationId: CID, taskId })?.code ?? "read";

    expect([code(A), code(D)]).toEqual(["read", "E-AUTHORITY"]);
  });

  test("every Task's Logbook at once is for the Lead and the user only", () => {
    expect(reads(lead)).toBe("read");
    expect(reads(user)).toBe("read");
    expect(reads(as(DEPENDENT))).toBe("E-AUTHORITY");
  });

  test("a Task that doesn't exist is refused by name", () => {
    expect(reads(user, TaskId.make("Z"))).toBe("E-TASK-UNKNOWN");
  });
});
