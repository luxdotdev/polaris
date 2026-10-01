/**
 * A pull request's comments as Review shows them (ENG-223): GitHub's pending review is the
 * truth. Threads on lines sit in the diff; outdated threads and drafts, and whole-file
 * threads, are listed in the risk column, drafts anchored to the commit they were written on.
 */
import type {
  PullDetailView,
  ReviewCommentView,
  ReviewEvent,
  ReviewThreadView,
} from "../../../../shared/github.ts";

export interface InlineThread {
  readonly thread: ReviewThreadView;
  readonly path: string;
  readonly side: "new" | "old";
  readonly line: number;
  readonly startLine: number | null;
}

export interface ThreadPlaces {
  readonly inline: ReadonlyArray<InlineThread>;
  /** Their lines are gone at the head: drafts kept and anchored, published ones collapsed. */
  readonly outdated: ReadonlyArray<ReviewThreadView>;
  /** About a whole file. */
  readonly files: ReadonlyArray<ReviewThreadView>;
}

export const placeThreads = (threads: ReadonlyArray<ReviewThreadView>): ThreadPlaces => {
  const inline: Array<InlineThread> = [];
  const outdated: Array<ReviewThreadView> = [];
  const files: Array<ReviewThreadView> = [];

  for (const thread of threads) {
    const { anchor } = thread;

    if (anchor.kind === "line") {
      inline.push({
        thread,
        path: thread.path,
        side: anchor.side === "left" ? "old" : "new",
        line: anchor.line,
        startLine: anchor.startLine,
      });
    } else if (anchor.kind === "outdated") {
      outdated.push(thread);
    } else {
      files.push(thread);
    }
  }

  return { inline, outdated, files };
};

/** A thread the pending review starts; a pending reply on a published thread doesn't make one. */
export const isDraft = (thread: ReviewThreadView) => thread.comments[0]?.pending === true;

export interface PendingComment {
  readonly threadId: string;
  readonly comment: ReviewCommentView;
  /** "eligibility.ts:38–39", or the path for a whole file. */
  readonly place: string;
}

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export const placeLabel = (thread: ReviewThreadView): string => {
  const { anchor } = thread;
  const name = fileName(thread.path);

  if (anchor.kind === "line") {
    return anchor.startLine === null || anchor.startLine === anchor.line
      ? `${name}:${anchor.line}`
      : `${name}:${anchor.startLine}–${anchor.line}`;
  }

  if (anchor.kind === "outdated") {
    return anchor.originalLine === null
      ? `${name} (outdated)`
      : `${name}:${anchor.originalLine} (outdated)`;
  }

  return name;
};

/** Everything the pending review would send: each draft comment by place. */
export const pendingComments = (detail: PullDetailView): ReadonlyArray<PendingComment> =>
  detail.threads.flatMap((thread) =>
    thread.comments
      .filter((c) => c.pending)
      .map((comment) => ({ threadId: thread.id, comment, place: placeLabel(thread) }))
  );

export const pendingCount = (detail: PullDetailView | null) =>
  detail === null
    ? 0
    : Math.max(detail.pendingReview?.comments ?? 0, pendingComments(detail).length);

export interface SubmitChoice {
  readonly event: ReviewEvent;
  readonly label: string;
  /** What choosing it means (Paper R7): "1 high finding is still open". */
  readonly caption: string;
  /** Why it can't be chosen, or null. */
  readonly blocked: string | null;
}

export interface OpenRisk {
  readonly severity: "critical" | "high" | "medium" | "low";
  readonly count: number;
}

const riskCaption = (risk: OpenRisk | null) => {
  if (risk === null) return "Nothing in the risk summary is still open";

  return `${risk.count} ${risk.severity} ${risk.count === 1 ? "finding is" : "findings are"} still open`;
};

/** The three choices of the submit popover, with their consequences. */
export const submitChoices = (
  detail: PullDetailView,
  risk: OpenRisk | null
): ReadonlyArray<SubmitChoice> => {
  const own = detail.author !== null && detail.author.login === detail.viewerLogin;
  const author = detail.author?.login ?? "The author";
  const ownBlock = own ? "You can’t approve or request changes on your own pull request" : null;

  return [
    { event: "comment", label: "Comment", caption: "Feedback without a decision", blocked: null },
    {
      event: "approve",
      label: "Approve",
      caption: riskCaption(risk),
      blocked: ownBlock ?? (detail.viewerCanApprove ? null : "You can’t approve this pull request"),
    },
    {
      event: "request-changes",
      label: "Request changes",
      caption: `${author} has to address it before merging`,
      blocked: ownBlock,
    },
  ];
};

/** Why the chosen submit can't go yet, or null (GitHub's own rules, checked before asking it). */
export const submitProblem = (event: ReviewEvent, body: string, pending: number): string | null => {
  if (event === "request-changes" && body.trim() === "") return "Say what needs to change";

  if (event === "comment" && body.trim() === "" && pending === 0) return "Write a comment first";

  return null;
};

export const SUBMIT_LABEL: Readonly<Record<ReviewEvent, string>> = {
  comment: "Comment",
  approve: "Approve",
  "request-changes": "Request changes",
};

/** "3 pending comments go out together". */
export const pendingCaption = (n: number) =>
  n === 0
    ? "No pending comments"
    : `${n} pending ${n === 1 ? "comment goes" : "comments go"} out together`;
