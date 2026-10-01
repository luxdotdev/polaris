/**
 * What a Risk Summary covers: the commits (or trees) to diff, the directory
 * holding them, and the key it is cached under (ENG-185: per repo, merge base
 * and head). A pull request reads its Review Checkout; Agent Session Turns
 * read their checkpoints; "only the new changes" diffs from the interdiff.
 */
import {
  GitError,
  NotFound,
  type ReviewCheckoutId,
  ReviewSubject,
  repoKey,
  RiskSummaryKey,
  type SessionId,
  type Turn,
  type TurnId,
  type WorkspaceId,
} from "@polaris/protocol";
import { Effect } from "effect";
import { checkoutGit } from "../git/review/refs.ts";
import { ReviewCheckoutGit } from "../services.ts";
import { EventStore } from "../store/EventStore.ts";
import { composeTurns, type TurnCommits } from "./compose.ts";
import type { RulesMode } from "../rules/index.ts";

export interface ReviewRange {
  readonly key: RiskSummaryKey;
  readonly workspaceId: WorkspaceId;
  /** Where git and the Reviewer run: the Review Checkout, or the session's directory. */
  readonly cwd: string;
  /** What the diff starts from: the merge base, a Turn's before-checkpoint, or the interdiff's tree. */
  readonly base: string;
  readonly head: string;
  /** The real merge base, recorded on the checkout once reviewed. */
  readonly mergeBase: string;
  readonly mode: RulesMode;
  readonly checkoutId: ReviewCheckoutId | null;
  /** "Pull request #12", or the session's title. */
  readonly title: string;
  /** For Agent Sessions: the Turns' prompts, in order. */
  readonly prompts: ReadonlyArray<string>;
  /** When "only the new changes" fell back to a full summary: why, as a user reads it. */
  readonly note: string | null;
}

const gitError = (cwd: string) => (cause: { readonly message: string }) =>
  new GitError({ cwd, message: cause.message });

const commitOf = (cwd: string, ref: string) =>
  Effect.tryPromise({
    try: () => checkoutGit(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]),
    catch: (cause) => new GitError({ cwd, message: String(cause) }),
  });

const pullRequestRange = Effect.fn("pullRequestRange")(function* (
  subject: Extract<ReviewSubject, { _tag: "PullRequest" }>,
  checkoutId: ReviewCheckoutId | null,
  since: string | null
) {
  const store = yield* EventStore;
  const git = yield* ReviewCheckoutGit;
  const model = yield* store.model;
  const checkout = checkoutId === null ? undefined : model.reviewCheckouts.get(checkoutId);
  const workspace = checkout && model.workspaces.get(checkout.workspaceId);

  if (checkout === undefined || workspace === undefined) {
    return yield* new NotFound({ what: "review checkout", id: checkoutId ?? "none" });
  }

  if (checkout.head === null || checkout.mergeBase === null) {
    return yield* new GitError({
      cwd: checkout.path,
      message: "The Review Checkout isn't checked out yet",
    });
  }

  const full: ReviewRange = {
    key: RiskSummaryKey.make({
      repo: repoKey(subject.pullRequest.repo),
      mergeBase: checkout.mergeBase,
      head: checkout.head,
      since: null,
    }),
    workspaceId: checkout.workspaceId,
    cwd: checkout.path,
    base: checkout.mergeBase,
    head: checkout.head,
    mergeBase: checkout.mergeBase,
    mode: "history",
    checkoutId: checkout.id,
    title: `Pull request #${subject.pullRequest.number}`,
    prompts: [],
    note: null,
  };

  if (since === null || since === checkout.head) return full;

  const interdiff = yield* git
    .interdiff({
      repoPath: workspace.path,
      reviewed: since,
      reviewedBase: checkout.reviewedMergeBase ?? checkout.mergeBase,
      head: checkout.head,
      base: checkout.latestBase || checkout.mergeBase,
    })
    .pipe(Effect.mapError(gitError(checkout.path)));

  if (interdiff.from === null) return { ...full, note: interdiff.reason };

  const incremental: ReviewRange = {
    ...full,
    key: RiskSummaryKey.make({
      repo: full.key.repo,
      mergeBase: interdiff.from,
      head: full.key.head,
      since,
    }),
    base: interdiff.from,
    mode: "snapshot",
  };

  return incremental;
});

const inRange = (
  turns: ReadonlyArray<Turn>,
  first: TurnId | null,
  last: TurnId | null
): ReadonlyArray<Turn> => {
  const start = first === null ? 0 : turns.findIndex((t) => t.id === first);
  const end = last === null ? turns.length - 1 : turns.findIndex((t) => t.id === last);

  return start === -1 || end === -1 ? [] : turns.slice(start, end + 1);
};

const sessionRange = Effect.fn("sessionRange")(function* (
  subject: Extract<ReviewSubject, { _tag: "SessionTurns" }>,
  checkoutId: ReviewCheckoutId | null
) {
  const store = yield* EventStore;
  const model = yield* store.model;
  const record = model.sessions.get(subject.sessionId);
  const workspace = record && model.workspaces.get(record.session.workspaceId);

  if (record === undefined || workspace === undefined) {
    return yield* new NotFound({ what: "session", id: subject.sessionId });
  }

  const turns = yield* store
    .readTurns({ sessionId: subject.sessionId, beforeIndex: null, limit: null })
    .pipe(Effect.mapError(gitError(record.session.cwd)));

  const covered = inRange(turns, subject.firstTurnId, subject.lastTurnId).filter(
    (t) => t.status !== "working"
  );

  const before = covered[0]?.checkpointBefore ?? null;
  const after = covered.at(-1)?.checkpointAfter ?? null;

  if (before === null || after === null) {
    return yield* new NotFound({ what: "turn checkpoints", id: subject.sessionId });
  }

  const checkout = checkoutId === null ? undefined : model.reviewCheckouts.get(checkoutId);
  const cwd = checkout?.path ?? record.session.cwd;
  const first = yield* commitOf(cwd, before);
  const last = yield* commitOf(cwd, after);
  const commits: Array<TurnCommits> = [];

  for (const turn of covered) {
    if (turn.checkpointBefore === null || turn.checkpointAfter === null) continue;
    commits.push({
      before: yield* commitOf(cwd, turn.checkpointBefore),
      after: yield* commitOf(cwd, turn.checkpointAfter),
    });
  }

  // The Turns' own changes, not first-before..last-after: commits between Turns stay out.
  const change = yield* Effect.tryPromise({
    try: () => composeTurns(cwd, commits),
    catch: (cause) => new GitError({ cwd, message: String(cause) }),
  });

  const range: ReviewRange = {
    key: RiskSummaryKey.make({ repo: workspace.path, mergeBase: first, head: last, since: null }),
    workspaceId: workspace.id,
    cwd,
    base: change.base,
    head: change.head,
    mergeBase: first,
    mode: "snapshot",
    checkoutId: checkout?.id ?? null,
    title: record.session.title,
    prompts: covered.map((t) => t.prompt),
    note: null,
  };

  return range;
});

export const resolveRange = (
  subject: ReviewSubject,
  checkoutId: ReviewCheckoutId | null,
  since: string | null
): Effect.Effect<ReviewRange, NotFound | GitError, EventStore | ReviewCheckoutGit> =>
  ReviewSubject.match(subject, {
    PullRequest: (pr) => pullRequestRange(pr, checkoutId, since),
    SessionTurns: (turns) => sessionRange(turns, checkoutId),
  });

/** The session a SessionTurns subject reviews, else null. */
export const reviewedSessionOf = (subject: ReviewSubject): SessionId | null =>
  ReviewSubject.match(subject, {
    PullRequest: () => null,
    SessionTurns: ({ sessionId }) => sessionId,
  });
