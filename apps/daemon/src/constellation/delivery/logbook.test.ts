import { expect, test } from "bun:test";
import {
  AnswerAction,
  AttemptCause,
  CommandId,
  ConstellationQuestion,
  ReviewAction,
  WorkerPlacement,
} from "@polaris/protocol";
import { Effect } from "effect";
import { A, C, CID, ctx, draft } from "../../engine/constellation.testing.ts";
import { EventStore } from "../../store/EventStore.ts";
import { foldLogbook, logbookPage } from "../logbook/index.ts";
import { as, lead, RETRY, Story, WORKER } from "../logbook/logbook.testing.ts";
import { Constellations } from "../service.ts";
import { sendBack } from "../composition/sendback.testing.ts";
import { startAttempt } from "../composition/workers.ts";
import { sendbackWorld } from "../../mcp/sendback.testing.ts";
import { setup, WORKER as SETUP_WORKER } from "./testing.ts";
import { attemptDigest } from "./logbook.ts";

/** A's first Attempt asks, is answered, notes `notes` times, and is sent back to a second. */
const sentBack = (notes: number) => {
  const s = new Story();

  s.dispatch(A, "a1", WORKER);
  const first = s.latest(A);
  s.run(
    C.WorkerAsk.make({
      constellationId: CID,
      attemptId: first.id,
      question: new ConstellationQuestion({
        id: "base",
        to: "lead",
        text: "Which base?",
        blocking: true,
      }),
    }),
    ctx({ binding: as(WORKER) })
  );
  s.run(
    C.Answer.make({
      constellationId: CID,
      action: AnswerAction.cases.Question.make({
        attemptId: first.id,
        questionId: "base",
        text: "Use main.",
      }),
    }),
    ctx({ binding: lead })
  );

  for (let i = 1; i <= notes; i++) s.note(A, `Decision ${i}.`, as(WORKER));
  s.claim(A, "head-1");
  s.run(
    C.Review.make({
      constellationId: CID,
      attemptId: first.id,
      revision: s.latest(A).revision,
      action: ReviewAction.cases.SendBack.make({
        reason: "The cursor test is missing.",
        worker: WorkerPlacement.cases.Existing.make({ sessionId: RETRY }),
      }),
    }),
    ctx({
      binding: lead,
      attempts: [draft(A, "a2", RETRY, AttemptCause.cases.SentBack.make({ ref: first.id }))],
    })
  );

  const { fold, entries } = foldLogbook(s.envelopes);
  const page = logbookPage(fold, entries, { constellationId: CID, taskId: A }, s.envelopes.length);

  return { page, first: s.record.graph.attempts.find((a) => a.id === first.id)! };
};

test("the digest carries the question, its answer, the notes and the send-back reason, and leaves out progress and Claims", () => {
  const { page, first } = sentBack(2);
  const digest = attemptDigest(page, first);

  expect(digest.split("\n").map((l) => l.replace(/^#\d+ · /, ""))).toEqual([
    "Logbook since Attempt 1 started (a1), oldest first:",
    "Attempt 1 · worker · asks lead (questionId base): Which base?",
    "Attempt 1 · lead · answers base: Use main.",
    "Attempt 1 · worker · note: Decision 1.",
    "Attempt 1 · worker · note: Decision 2.",
    "Attempt 1 · lead · sent back: The cursor test is missing.",
  ]);
});

test("over the entry cap the newest entries win and a line counts the rest and how to read them", () => {
  const { page, first } = sentBack(10);
  const boundary = page.attempts.find((a) => a.attemptId === first.id)!;
  const lines = attemptDigest(page, first, { entries: 3, chars: 10_000, line: 600 }).split("\n");

  expect(lines.slice(1, 4).map((l) => l.replace(/^#\d+ · /, ""))).toEqual([
    "Attempt 1 · worker · note: Decision 9.",
    "Attempt 1 · worker · note: Decision 10.",
    "Attempt 1 · lead · sent back: The cursor test is missing.",
  ]);
  // 13 entries carried: the question, its answer, ten notes and the send-back.
  expect(lines[4]).toBe(
    `10 earlier entries were left out; logbook_read { task: A, since: ${boundary.sequence} } has the rest.`
  );
});

test("the character cap drops older entries too, and cuts one longer than a line", () => {
  const { page, first } = sentBack(10);
  const digest = attemptDigest(page, first, { entries: 50, chars: 100, line: 40 });
  const kept = digest.split("\n").slice(1, -1);

  expect(kept).toHaveLength(2);
  expect(kept.at(-1)).toBe("#22 · Attempt 1 · lead · sent back: The…");
  expect(digest.split("\n").at(-1)).toStartWith("11 earlier entries were left out");
});

test("a sent-back Attempt's first Turn carries the digest of its Task's Logbook", async () => {
  const w = sendbackWorld(":memory:", false);

  await w.run(
    Effect.gen(function* () {
      yield* setup();
      const graphs = yield* Constellations;
      const store = yield* EventStore;
      const worker = { kind: "session" as const, sessionId: SETUP_WORKER };
      const first = (yield* store.model).constellations.get(CID)!.graph.attempts[0]!;

      yield* graphs.command(
        worker,
        CommandId.make("ask"),
        C.WorkerAsk.make({
          constellationId: CID,
          attemptId: first.id,
          question: new ConstellationQuestion({
            id: "scope",
            to: "lead",
            text: "Keep the old API?",
            blocking: false,
          }),
        })
      );
      yield* graphs.command(
        { kind: "user" },
        CommandId.make("answer"),
        C.Answer.make({
          constellationId: CID,
          action: AnswerAction.cases.Question.make({
            attemptId: first.id,
            questionId: "scope",
            text: "Drop it.",
          }),
        })
      );
      yield* graphs.command(
        worker,
        CommandId.make("note"),
        C.Note.make({ constellationId: CID, taskId: A, text: "The fold is pure." })
      );

      const attempt = yield* sendBack();
      const graph = (yield* store.model).constellations.get(CID)!.graph;
      yield* startAttempt(graph, attempt);

      const prompt = w.turns[0]!.prompt;

      expect(prompt).toContain("Logbook since Attempt 1 started (a1), oldest first:");
      expect(prompt).toContain("asks lead (questionId scope): Keep the old API?");
      expect(prompt).toContain("answers scope: Drop it.");
      expect(prompt).toContain("worker · note: The fold is pure.");
      expect(prompt).toContain("sent back: Finish the cleanup");
    })
  );
});
