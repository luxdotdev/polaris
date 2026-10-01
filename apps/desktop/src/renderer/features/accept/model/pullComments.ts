/**
 * Review comments on an accepted session's pull request, as the session's next Turn
 * (ENG-224): each unresolved thread with something new since it was last sent becomes one
 * feedback comment, its discussion as the note. Pure.
 */
import { FeedbackBatch, FeedbackComment, LineRange } from "@polaris/protocol";
import type { PullDetailView, ReviewThreadView } from "../../../../shared/github.ts";

/** Per thread, the last comment already sent to the session. */
export type SentComments = Readonly<Record<string, string>>;

const linesOf = (thread: ReviewThreadView): LineRange => {
  const { anchor } = thread;

  if (anchor.kind === "line") {
    return new LineRange({
      start: anchor.startLine ?? anchor.line,
      end: anchor.line,
      side: anchor.side === "left" ? "old" : "new",
    });
  }

  if (anchor.kind === "outdated") {
    const line = anchor.originalLine ?? 0;

    return new LineRange({
      start: anchor.originalStartLine ?? line,
      end: line,
      side: anchor.side === "left" ? "old" : "new",
    });
  }

  return new LineRange({ start: 0, end: 0, side: "new" });
};

const noteOf = (thread: ReviewThreadView) =>
  thread.comments
    .filter((c) => !c.pending)
    .map((c) => `${c.author ?? "someone"}: ${c.body.trim()}`)
    .join("\n\n");

/** Unresolved threads with a submitted comment newer than the one last sent. */
export const unsentThreads = (detail: PullDetailView, sent: SentComments) =>
  detail.threads.filter((thread) => {
    const last = thread.comments.filter((c) => !c.pending).at(-1);

    return !thread.isResolved && last !== undefined && sent[thread.id] !== last.id;
  });

export interface PullFeedback {
  readonly batch: FeedbackBatch;
  /** What to remember as sent once the Turn is accepted by the Daemon. */
  readonly sent: SentComments;
}

export const pullFeedback = (detail: PullDetailView, sent: SentComments): PullFeedback | null => {
  const threads = unsentThreads(detail, sent);

  if (threads.length === 0) return null;

  const comments = threads.map(
    (thread) =>
      new FeedbackComment({
        id: `gh-${thread.id}`,
        path: thread.path,
        lines: linesOf(thread),
        code: thread.anchor.kind === "outdated" ? thread.anchor.diffHunk : "",
        note: noteOf(thread),
        findingId: null,
      })
  );

  const next = {
    ...sent,
    ...Object.fromEntries(
      threads.flatMap((thread) => {
        const last = thread.comments.filter((c) => !c.pending).at(-1);

        return last === undefined ? [] : [[thread.id, last.id] as const];
      })
    ),
  } satisfies SentComments;

  return {
    batch: new FeedbackBatch({
      message: `Review comments on pull request #${detail.number}. Address each one; reply in your summary if you disagree.`,
      comments,
    }),
    sent: next,
  };
};
