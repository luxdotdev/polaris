/**
 * The Logbook as the tab reads it (ADR 0119; DESIGN.md, Logbook): pages from the feed merged
 * into one log, then cut into the Task view's Attempts or the feed across Tasks.
 */
import type { LogbookAttempt, LogbookEntry, LogbookPage } from "@polaris/protocol";
import { Match, Predicate } from "effect";
import type { Plain } from "../../../store/plain.ts";
import { harnessWord, pluralize, shortSha } from "./copy.ts";

export type EntryData = Plain<LogbookEntry>;

export type AttemptMark = Plain<LogbookAttempt>;

export type PageData = Plain<LogbookPage>;

/** One Logbook read so far: every boundary as of the last page, entries oldest first. */
export interface LogbookLog {
  readonly attempts: ReadonlyArray<AttemptMark>;
  readonly entries: ReadonlyArray<EntryData>;
  readonly cursor: number;
}

export const emptyLog: LogbookLog = { attempts: [], entries: [], cursor: 0 };

const bySequence = (a: { readonly sequence: number }, b: { readonly sequence: number }) =>
  a.sequence - b.sequence;

/** A later page replaces every boundary and adds its entries; an entry seen twice is kept once. */
export const mergePage = (log: LogbookLog, page: PageData): LogbookLog => {
  const known = new Set(log.entries.map((e) => e.id));
  const fresh = page.entries.filter((e) => !known.has(e.id));

  return {
    attempts: page.attempts.toSorted(bySequence),
    entries: fresh.length === 0 ? log.entries : [...log.entries, ...fresh].toSorted(bySequence),
    cursor: Math.max(log.cursor, page.cursor),
  };
};

/** An Attempt's stretch of a Task's log: its boundary, then its entries. */
export interface AttemptSection {
  readonly attempt: AttemptMark;
  readonly entries: ReadonlyArray<EntryData>;
}

export interface TaskTimeline {
  /** Entries before the first Attempt (the brief as declared, early notes). */
  readonly before: ReadonlyArray<EntryData>;
  readonly sections: ReadonlyArray<AttemptSection>;
}

/** Splits a Task's log at its Attempt boundaries, oldest first. */
export const timelineOf = (log: LogbookLog, taskId: string): TaskTimeline => {
  const attempts = log.attempts.filter((a) => a.taskId === taskId);
  const entries = log.entries.filter((e) => e.taskId === taskId);
  const ids = new Set(attempts.map((a) => a.attemptId));

  const sections = attempts.map((attempt) => ({
    attempt,
    entries: entries.filter((e) => e.attemptId === attempt.attemptId),
  }));

  return {
    before: entries.filter((e) => e.attemptId === null || !ids.has(e.attemptId)),
    sections,
  };
};

/** Every Attempt but the latest folds until opened ("Show 7 entries"). */
export const foldedByDefault = (timeline: TaskTimeline, attemptId: string) =>
  timeline.sections.at(-1)?.attempt.attemptId !== attemptId;

/** The feed across Tasks: newest first. */
export const feedOf = (log: LogbookLog): ReadonlyArray<EntryData> => log.entries.toReversed();

const REVIEW_KIND = {
  approved: "approved",
  handed_up: "handed up",
  accepted: "accepted",
  sent_back: "sent back",
} as const;

/** The faint mono lane: what kind of entry this is, in lowercase words. */
export const kindWord = (entry: EntryData): string =>
  Match.value(entry).pipe(
    Match.tagsExhaustive({
      Brief: () => "brief",
      Progress: () => "progress",
      Question: () => "question",
      Answer: () => "answer",
      Message: () => "message",
      Claim: () => "claim",
      Review: (e) => REVIEW_KIND[e.outcome],
      Inspection: () => "inspection",
      Lost: (e) => e.outcome,
      Note: () => "note",
    })
  );

/** Who wrote it: a role, or the other Task of a peer message it received. */
export interface AuthorWord {
  readonly text: string;
  /** A Task id, set in mono. */
  readonly id: boolean;
}

export const authorWord = (entry: EntryData): AuthorWord => {
  if (
    Predicate.isTagged(entry, "Message") &&
    entry.channel === "peer" &&
    !entry.outgoing &&
    entry.peer !== null
  )
    return { text: entry.peer, id: true };

  return { text: entry.author, id: false };
};

const CAUSE: Readonly<Record<AttemptMark["cause"], string>> = {
  Initial: "first attempt",
  SentBack: "fresh session",
  MergeConflict: "merge conflict",
  Recover: "recovered",
  Followup: "follow-up",
  Superseded: "superseded",
};

const OUTCOME: Readonly<Partial<Record<AttemptMark["state"], string>>> = {
  review: "in review",
  accepted: "accepted",
  rejected: "sent back",
  lost: "lost",
  failed: "failed",
};

/** "codex · gpt-6.1-sol · 13:02 – 13:36 · sent back", or "… · fresh session · since 13:38". */
export const boundaryLine = (attempt: AttemptMark, clock: (iso: string) => string): string => {
  const who = [harnessWord(attempt.harness), attempt.model].filter((p) => p !== null);

  const when =
    attempt.endedAt === null
      ? [CAUSE[attempt.cause], `since ${clock(attempt.startedAt)}`]
      : [
          `${clock(attempt.startedAt)} – ${clock(attempt.endedAt)}`,
          OUTCOME[attempt.state] ?? attempt.state,
        ];

  return [...who, ...when].join(" · ");
};

/** Where an Inspection's verdict went, the card's last line. */
export const inspectionRoute = (entry: Extract<EntryData, { _tag: "Inspection" }>): string =>
  Match.value(entry.route).pipe(
    Match.when("lead", () => "Sent to the lead · the lead accepts"),
    Match.when("accepted", () => "Approved and accepted · the inspector may accept"),
    Match.when("sent_back", () =>
      entry.nextAttempt === null ? "Sent back" : `Sent back · attempt ${entry.nextAttempt}`
    ),
    Match.exhaustive
  );

export const verdictWord = (entry: Extract<EntryData, { _tag: "Inspection" }>) =>
  entry.verdict === "approve" ? "Approved" : "Sent back";

/** "3 commits · all done" or "1 not done" after a Claim's checks. */
export const claimTail = (entry: Extract<EntryData, { _tag: "Claim" }>): string => {
  const { claim } = entry;

  const rest =
    claim.notDone.length === 0 ? "all done" : `${pluralize(claim.notDone.length, "item")} not done`;

  return [pluralize(claim.commits.length, "commit"), rest].join(" · ");
};

/** The caption under a row, when its kind has one. */
export const entryCaption = (entry: EntryData, log: LogbookLog): string | null =>
  Match.value(entry).pipe(
    Match.tag("Question", (e) => {
      const answered = log.entries.some(
        (a) => Predicate.isTagged(a, "Answer") && a.questionId === e.question.id
      );

      return `to the ${e.question.to === "user" ? "user" : "lead"} · ${answered ? "answered" : "open"}`;
    }),
    Match.tag("Progress", (e) =>
      e.completed === null || e.total === null ? null : `${e.completed} of ${e.total}`
    ),
    Match.tag("Message", (e) => {
      if (e.channel === "operator") return "to the worker";

      return e.outgoing && e.peer !== null ? `to ${e.peer}` : null;
    }),
    Match.tag("Review", (e) => (e.mergedHead === null ? null : `merged ${shortSha(e.mergedHead)}`)),
    Match.tag("Claim", (e) => (e.amends === null ? null : `replaces ${shortSha(e.amends)}`)),
    Match.orElse(() => null)
  );

/** A one-line summary for the feed across Tasks. */
export const feedText = (entry: EntryData): string =>
  Match.value(entry).pipe(
    Match.tag("Claim", (e) => `${shortSha(e.claim.head)} · ${claimTail(e)}`),
    Match.tag("Inspection", (e) => `${verdictWord(e)} · ${e.text}`),
    Match.tag("Lost", (e) =>
      [`Attempt ${e.attempt ?? "?"} ${e.outcome}`, e.text].filter((p) => p !== "").join(" · ")
    ),
    Match.tag("Brief", (e) => (e.text === "" ? e.title : e.text)),
    Match.orElse((e) => e.text)
  );

export type TallyState = "working" | "review" | "ready" | "needs-you" | "done" | "blocked";

const TALLY_WORD: ReadonlyArray<readonly [TallyState, string]> = [
  ["working", "working"],
  ["review", "in review"],
  ["blocked", "blocked"],
  ["ready", "ready"],
  ["needs-you", "needs you"],
  ["done", "done"],
];

/** "4 working · 2 in review · 3 ready · 1 needs you · 5 done", zeros left out. */
export const tallyOf = (
  states: ReadonlyArray<TallyState | null>
): ReadonlyArray<{ readonly state: TallyState; readonly text: string }> =>
  TALLY_WORD.flatMap(([state, word]) => {
    const n = states.filter((s) => s === state).length;

    return n === 0 ? [] : [{ state, text: `${n} ${word}` }];
  });
