import { describe, expect, test } from "bun:test";
import {
  ConstellationEvent,
  type LogbookEntry,
  MessageTarget,
  Sequence,
  Task,
} from "@polaris/protocol";
import { Predicate } from "effect";
import { A, B, CID } from "../../engine/constellation.testing.ts";
import { taskData } from "../data.ts";
import { foldLogbook, stepLogbook } from "./fold.ts";
import { D, story } from "./logbook.testing.ts";
import { logbookPage } from "./page.ts";

const page = (taskId?: typeof A, since?: number) => {
  const s = story();
  const { fold, entries } = foldLogbook(s.envelopes);

  return logbookPage(
    fold,
    entries,
    {
      constellationId: CID,
      taskId,
      since: since === undefined ? undefined : Sequence.make(since),
    },
    s.envelopes.length
  );
};

const row = (e: LogbookEntry) => `${e._tag} ${e.author} #${e.attempt ?? "-"}`;

describe("a Task's Logbook", () => {
  test("spans every Attempt, oldest first, each entry under the Attempt it happened in", () => {
    expect(page(A).entries.map(row)).toEqual([
      "Brief lead #-",
      "Progress worker #1",
      "Question worker #1",
      "Answer lead #1",
      "Message you #1",
      "Note worker #1",
      "Note lead #1",
      "Claim worker #1",
      "Review lead #1",
      "Message worker #2",
      "Claim worker #2",
      "Review lead #2",
    ]);
  });

  test("starts each Attempt with a boundary that holds how it began and ended", () => {
    const { attempts, entries } = page(A);

    expect(attempts.map((a) => `${a.number} ${a.cause} ${a.state} ${a.sessionId}`)).toEqual([
      "1 Initial rejected worker",
      "2 SentBack accepted retry",
    ]);

    const sentBack = entries.find(
      (e) => Predicate.isTagged(e, "Review") && e.outcome === "sent_back"
    );

    // The second boundary sits after the send-back that caused it and before its own entries.
    expect(attempts[1]!.sequence).toBeGreaterThan(sentBack!.sequence);
    expect(
      entries.filter((e) => e.attempt === 2).every((e) => e.sequence > attempts[1]!.sequence)
    ).toBe(true);
    expect(attempts[0]!.endedAt).not.toBeNull();
  });

  test("carries what each kind of entry is about", () => {
    const entries = page(A).entries;

    const of = <T extends LogbookEntry["_tag"]>(tag: T) =>
      entries.filter((e): e is Extract<LogbookEntry, { _tag: T }> => e._tag === tag);

    expect(of("Brief")[0]).toMatchObject({ text: "Build A", title: "A" });
    expect(of("Progress")[0]).toMatchObject({ text: "Reading the store", completed: 1, total: 3 });
    expect(of("Question")[0]).toMatchObject({
      text: "Which base?",
      question: { id: "base", to: "lead" },
    });
    expect(of("Answer")[0]).toMatchObject({ text: "Use main.", questionId: "base" });
    expect(of("Message")[0]).toMatchObject({
      text: "Keep the fold pure.",
      channel: "operator",
      peer: null,
    });
    expect(of("Claim").map((e) => e.claim.head)).toEqual(["head-1", "head-2"]);
    expect(of("Review").map((e) => [e.outcome, e.text, e.mergedHead])).toEqual([
      ["sent_back", "The cursor test is missing.", null],
      ["accepted", "", "head-2"],
    ]);
    expect(of("Note").map((e) => e.text)).toEqual([
      "The fold reuses the graph fold.",
      "Watch the cursor.",
    ]);
  });

  test("a peer message is on both Tasks' Logbooks, and a stopped Attempt ends as lost", () => {
    const sent = page(A).entries.find((e) => Predicate.isTagged(e, "Message") && e.outgoing);

    expect(sent).toMatchObject({ channel: "peer", peer: B, attempt: 2 });
    expect(page(B).entries.map((e) => [e._tag, e.author, e.text])).toEqual([
      ["Brief", "lead", "Build B"],
      ["Message", "worker", "Which event names the note?"],
      ["Lost", "polaris", "No longer needed."],
    ]);
    expect(page(B).entries[1]).toMatchObject({ channel: "peer", peer: A, outgoing: false });
    expect(page(B).attempts.map((a) => a.state)).toEqual(["lost"]);
  });

  test("a read since a cursor returns only later entries, and still every boundary", () => {
    const all = page(A);
    const claim = all.entries.find((e) => Predicate.isTagged(e, "Claim"))!;
    const later = page(A, claim.sequence);

    expect(later.entries.map((e) => e.id)).toEqual(
      all.entries.filter((e) => e.sequence > claim.sequence).map((e) => e.id)
    );
    expect(later.entries.length).toBeGreaterThan(0);
    expect(later.attempts).toEqual(all.attempts);
    expect(page(A, all.cursor).entries).toEqual([]);
  });

  test("without a Task it is every Task's entries in commit order", () => {
    const every = page();
    const sequences = every.entries.map((e) => e.sequence);

    expect(new Set(every.entries.map((e) => e.taskId))).toEqual(new Set([A, B, D]));
    expect(sequences).toEqual([...sequences].sort((x, y) => x - y));
    expect(new Set(every.entries.map((e) => e.id)).size).toBe(every.entries.length);
    expect(every.attempts.map((a) => `${a.taskId}${a.number}`)).toEqual(["A1", "A2", "B1", "D1"]);
  });

  test("folding event by event gives the same entries as folding the whole log", () => {
    const s = story();
    const whole = foldLogbook(s.envelopes);
    const stepped: Array<LogbookEntry> = [];
    let fold = foldLogbook([]).fold;

    for (const envelope of s.envelopes) {
      const step = stepLogbook(fold, envelope);
      fold = step.fold;
      stepped.push(...step.entries);
    }

    expect(stepped).toEqual(whole.entries);
    expect(fold.record?.graph.attempts.map((a) => [a.id, a.state])).toEqual(
      s.record.graph.attempts.map((a) => [a.id, a.state])
    );
  });

  test("an edit that leaves the brief alone adds nothing; one that changes it adds the new brief", () => {
    const s = story();
    const task = s.record.graph.tasks.find((t) => t.id === A)!;
    const next = { sequence: Sequence.make(900), occurredAt: "2026-10-02T00:00:00.000Z" };
    const { fold } = foldLogbook(s.envelopes);

    const edit = (brief: string) =>
      stepLogbook(fold, {
        ...next,
        event: ConstellationEvent.cases.TaskEdited.make({
          constellationId: CID,
          revision: s.record.graph.revision + 1,
          task: new Task({
            ...taskData(task),
            brief,
            canceled: false,
            revision: task.revision + 1,
          }),
        }),
      }).entries;

    expect(edit(task.brief)).toEqual([]);
    expect(edit("Build A on main").map((e) => [e._tag, e.text, e.attempt])).toEqual([
      ["Brief", "Build A on main", 2],
    ]);
  });

  test("an operator message from before its sender was recorded reads as the Lead's", () => {
    const s = story();
    const { fold } = foldLogbook(s.envelopes);

    const [entry] = stepLogbook(fold, {
      sequence: Sequence.make(900),
      occurredAt: "2026-10-02T00:00:00.000Z",
      event: ConstellationEvent.cases.OperatorMessageSent.make({
        constellationId: CID,
        revision: s.record.graph.revision + 1,
        id: "old",
        authority: "conversation",
        target: MessageTarget.cases.All.make({}),
        text: "Rebase on main.",
        questionId: null,
        actor: null,
        by: null,
      }),
    }).entries;

    // Only D's Attempt is active: a broadcast lands on the Logbooks of the workers that heard it.
    expect([entry?.taskId, entry?.author, entry?._tag]).toEqual([D, "lead", "Message"]);
  });
});
