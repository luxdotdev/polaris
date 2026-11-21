import { describe, expect, test } from "bun:test";
import { Predicate } from "effect";
import { fakeNote, fixturePage, resetLogbook } from "../preview/logbook.ts";
import {
  emptyLog,
  entryCaption,
  feedOf,
  foldedByDefault,
  kindWord,
  type LogbookLog,
  mergePage,
  tallyOf,
  timelineOf,
} from "./logbook.ts";

const read = (taskId: string | null): LogbookLog => {
  resetLogbook();

  return mergePage(emptyLog, fixturePage(taskId));
};

describe("mergePage", () => {
  test("a page delivered twice adds its entries once, in sequence order", () => {
    const page = fixturePage(null);
    const log = mergePage(mergePage(emptyLog, page), page);

    expect(log.entries).toHaveLength(page.entries.length);
    expect(log.entries.map((e) => e.sequence)).toEqual(
      page.entries.map((e) => e.sequence).toSorted((a, b) => a - b)
    );
  });

  test("a later page's boundaries replace the earlier ones; its entries add to the log", () => {
    const first = read("B1");
    const other = fixturePage("B5");
    const later = mergePage(first, { ...fixturePage("B1"), entries: [], attempts: other.attempts });

    expect(later.attempts.map((a) => a.attemptId)).toEqual(other.attempts.map((a) => a.attemptId));
    expect(later.entries).toEqual(first.entries);
  });
});

describe("timelineOf", () => {
  test("splits a Task's entries at its Attempt boundaries, oldest first", () => {
    const timeline = timelineOf(read("B1"), "B1");

    expect(timeline.before.map((e) => e._tag)).toEqual(["Brief"]);
    expect(timeline.sections.map((s) => s.attempt.number)).toEqual([1, 2]);
    expect(timeline.sections[0]?.entries.map((e) => e._tag)).toEqual([
      "Progress",
      "Claim",
      "Review",
    ]);
    expect(timeline.sections[1]?.entries.at(-1)?._tag).toBe("Inspection");
  });

  test("only the latest Attempt is open by default", () => {
    const timeline = timelineOf(read("B5"), "B5");
    const ids = timeline.sections.map((s) => s.attempt.attemptId);

    expect(ids.map((id) => foldedByDefault(timeline, id))).toEqual([true, true, false]);
  });

  test("a note written on a Task lands on its latest Attempt", () => {
    resetLogbook();
    fakeNote({ taskId: "B5", text: "Check the Pi" });
    const log = mergePage(emptyLog, fixturePage("B5"));
    const last = timelineOf(log, "B5").sections.at(-1);

    expect(last?.attempt.number).toBe(3);
    expect(last?.entries.at(-1)?.text).toBe("Check the Pi");
  });
});

describe("rows", () => {
  test("the feed runs newest first", () => {
    const feed = feedOf(read(null));

    expect(feed[0]?.sequence).toBeGreaterThan(feed.at(-1)?.sequence ?? Infinity);
  });

  test("a review's kind names its outcome", () => {
    const kinds = read("B1").entries.flatMap((e) =>
      Predicate.isTagged(e, "Review") ? [kindWord(e)] : []
    );

    expect(kinds).toEqual(["sent back"]);
  });

  test("a question says whether it was answered", () => {
    const log = read("B1");
    const question = log.entries.find((e) => Predicate.isTagged(e, "Question"));

    expect(question === undefined ? null : entryCaption(question, log)).toBe(
      "to the lead · answered"
    );
    expect(
      question === undefined
        ? null
        : entryCaption(question, {
            ...log,
            entries: log.entries.filter((e) => !Predicate.isTagged(e, "Answer")),
          })
    ).toBe("to the lead · open");
  });
});

test("the tally keeps its order and leaves out zeros", () => {
  expect(tallyOf(["done", "working", null, "needs-you", "working"]).map((t) => t.text)).toEqual([
    "2 working",
    "1 needs you",
    "1 done",
  ]);
});
