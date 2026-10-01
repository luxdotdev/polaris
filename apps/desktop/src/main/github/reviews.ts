/**
 * One pull request's review: its files (with Viewed state) and threads, and the
 * pending review, created lazily by the first comment and submitted at the end.
 * Mutations are serialized per account, a second apart (GitHub's content limits).
 */
import { Clock, Effect, Semaphore } from "effect";
import type { DiffSide, PullRef, ReviewEvent } from "../../shared/github.ts";
import type { Client } from "./client.ts";
import { GitHubInvalidReview, GitHubNoAccount, GitHubNotFound } from "./errors.ts";
import {
  AddReplyData,
  AddReviewData,
  AddThreadData,
  AnyData,
  addReply,
  addReview,
  addThread,
  deleteComment,
  deleteReview,
  markViewed,
  PendingReviewData,
  PullDetailData,
  PullFilesData,
  PullThreadsData,
  pendingReview,
  pullDetail,
  pullFiles,
  pullThreads,
  resolveThread,
  submitReview,
  unmarkViewed,
  unresolveThread,
  updateComment,
} from "./queries.ts";
import type { Routing } from "./routing.ts";
import type { GraphQLRequest, Json } from "./transport.ts";
import { detailView } from "./views.ts";

/** GitHub asks for at least a second between mutations. */
export const MUTATION_GAP_MS = 1000;

/** Files and threads past this many pages of 100 are left out. */
const MAX_PAGES = 30;

export interface NewThread {
  readonly pull: PullRef;
  readonly pullId: string;
  /** The head the user saw, so lines resolve against it; null for the current head. */
  readonly commitOid: string | null;
  readonly path: string;
  readonly body: string;
  /** `file` comments on the whole file (no line). */
  readonly subjectType: "line" | "file";
  /** The last line of the range. */
  readonly line: number | null;
  readonly side: DiffSide;
  readonly startLine: number | null;
  readonly startSide: DiffSide | null;
}

export interface Reply {
  readonly pull: PullRef;
  readonly pullId: string;
  readonly threadId: string;
  readonly body: string;
}

export interface ThreadResolution {
  readonly pull: PullRef;
  readonly threadId: string;
  readonly resolved: boolean;
}

export interface CommentEdit {
  readonly pull: PullRef;
  readonly commentId: string;
  /** Null deletes the comment. */
  readonly body: string | null;
}

export interface Submission {
  readonly pull: PullRef;
  readonly pullId: string;
  readonly event: ReviewEvent;
  readonly body: string;
}

export interface Discard {
  readonly pull: PullRef;
  readonly pullId: string;
}

export interface ViewedMark {
  readonly pull: PullRef;
  readonly pullId: string;
  readonly path: string;
  readonly viewed: boolean;
}

const EVENTS: Readonly<Record<ReviewEvent, string>> = {
  approve: "APPROVE",
  "request-changes": "REQUEST_CHANGES",
  comment: "COMMENT",
};

const upper = (side: DiffSide) => side.toUpperCase();

const invalid = (message: string) => Effect.fail(new GitHubInvalidReview({ message }));

/** What GitHub would refuse in a new thread, said before asking. */
export const threadProblem = (thread: NewThread): string | null => {
  if (thread.body.trim() === "") return "A comment needs some text.";

  if (thread.subjectType === "file") return null;

  if (thread.line === null || thread.line < 1) return "A line comment needs a line.";

  if (
    thread.startLine !== null &&
    thread.startSide === thread.side &&
    thread.startLine > thread.line
  ) {
    return "A range must start before it ends.";
  }

  return null;
};

export const threadInput = (thread: NewThread, reviewId: string): Json => {
  const base = { pullRequestReviewId: reviewId, path: thread.path, body: thread.body };

  if (thread.subjectType === "file") return { ...base, subjectType: "FILE" };

  const line = { ...base, subjectType: "LINE", line: thread.line, side: upper(thread.side) };

  if (thread.startLine === null || thread.startLine === thread.line) return line;

  return {
    ...line,
    startLine: thread.startLine,
    startSide: upper(thread.startSide ?? thread.side),
  };
};

export interface ReviewsInput {
  readonly client: Client;
  readonly routing: Routing;
}

export const newReviews = ({ client, routing }: ReviewsInput) => {
  const pending = new Map<string, string>();
  const authors = new Map<string, { readonly author: string | null; readonly viewer: string }>();
  const locks = new Map<number, Semaphore.Semaphore>();
  const lastMutation = new Map<number, number>();
  const sentViewed = new Map<string, boolean>();
  const wantViewed = new Map<string, boolean>();

  const accountFor = (pull: PullRef) =>
    Effect.flatMap(routing.resolve(pull.repo, null), (access) =>
      access.accountId === null
        ? Effect.fail(
            new GitHubNoAccount({
              repo: `${pull.repo.owner}/${pull.repo.name}`,
              message: `No GitHub account can see ${pull.repo.owner}/${pull.repo.name}.`,
            })
          )
        : Effect.succeed(access.accountId)
    );

  const lockOf = (accountId: number) =>
    Effect.gen(function* () {
      const found = locks.get(accountId);

      if (found !== undefined) return found;

      const made = yield* Semaphore.make(1);

      locks.set(accountId, made);

      return made;
    });

  /** A mutation a second after the account's last one; callers hold the account's lock. */
  const paced = <S extends Parameters<Client["graphql"]>[1]>(
    accountId: number,
    schema: S,
    request: GraphQLRequest
  ) =>
    Effect.gen(function* () {
      const wait =
        (lastMutation.get(accountId) ?? 0) + MUTATION_GAP_MS - (yield* Clock.currentTimeMillis);

      if (wait > 0) yield* Effect.sleep(wait);

      return yield* client
        .graphql(accountId, schema, request)
        .pipe(
          Effect.ensuring(
            Effect.flatMap(Clock.currentTimeMillis, (now) =>
              Effect.sync(() => lastMutation.set(accountId, now))
            )
          )
        );
    });

  /** One mutation, queued behind the account's others. */
  const mutate = <S extends Parameters<Client["graphql"]>[1]>(
    accountId: number,
    schema: S,
    request: GraphQLRequest
  ) =>
    Effect.flatMap(lockOf(accountId), (lock) => lock.withPermit(paced(accountId, schema, request)));

  const morePages = <A, E>(
    first: {
      readonly nodes: ReadonlyArray<A>;
      readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
    },
    next: (after: string) => Effect.Effect<typeof first | null, E>
  ) =>
    Effect.gen(function* () {
      const all = [...first.nodes];
      let page: typeof first | null = first;

      for (
        let i = 1;
        i < MAX_PAGES && page?.pageInfo.hasNextPage === true && page.pageInfo.endCursor !== null;
        i += 1
      ) {
        page = yield* next(page.pageInfo.endCursor);
        all.push(...(page?.nodes ?? []));
      }

      return all;
    });

  /** The pull request as the Review shows it: files with Viewed state, every thread, the pending review. */
  const detail = (pull: PullRef) =>
    Effect.gen(function* () {
      const accountId = yield* accountFor(pull);

      const data = yield* client.graphql(
        accountId,
        PullDetailData,
        pullDetail({ owner: pull.repo.owner, name: pull.repo.name, number: pull.number })
      );

      const pr = data.repository?.pullRequest ?? null;

      if (data.repository === null || pr === null) {
        return yield* Effect.fail(
          new GitHubNotFound({ message: `No pull request #${pull.number}.` })
        );
      }

      const files = yield* morePages(pr.files, (after) =>
        Effect.map(
          client.graphql(accountId, PullFilesData, pullFiles({ id: pr.id, after })),
          (d) => d.node?.files ?? null
        )
      );

      const threads = yield* morePages(pr.reviewThreads, (after) =>
        Effect.map(
          client.graphql(accountId, PullThreadsData, pullThreads({ id: pr.id, after })),
          (d) => d.node?.reviewThreads ?? null
        )
      );

      const view = detailView({
        pull: pr,
        repo: data.repository.nameWithOwner,
        viewerLogin: data.viewer.login,
        files,
        threads,
        accountId,
      });

      authors.set(pr.id, { author: pr.author?.login ?? null, viewer: data.viewer.login });

      if (view.pendingReview === null) pending.delete(pr.id);
      else pending.set(pr.id, view.pendingReview.id);

      return view;
    });

  /** The viewer's pending review: the cached one, one started elsewhere, or a new one. */
  const ensurePending = (accountId: number, pullId: string, commitOid: string | null) =>
    Effect.gen(function* () {
      const cached = pending.get(pullId);

      if (cached !== undefined) return cached;

      const existing = yield* client.graphql(
        accountId,
        PendingReviewData,
        pendingReview({ id: pullId })
      );

      const found = existing.node?.reviews.nodes[0]?.id;

      const id =
        found ??
        (yield* mutate(
          accountId,
          AddReviewData,
          addReview({
            input: {
              pullRequestId: pullId,
              commitOID: commitOid,
            },
          })
        )).addPullRequestReview.pullRequestReview.id;

      pending.set(pullId, id);

      return id;
    });

  /** A dropped pending review (submitted or deleted on github.com) is looked up again. */
  const forget = (pullId: string) => Effect.sync(() => pending.delete(pullId));

  const addThreadTo = (thread: NewThread) =>
    Effect.gen(function* () {
      const problem = threadProblem(thread);

      if (problem !== null) return yield* invalid(problem);

      const accountId = yield* accountFor(thread.pull);
      const reviewId = yield* ensurePending(accountId, thread.pullId, thread.commitOid);

      const added = yield* mutate(
        accountId,
        AddThreadData,
        addThread({ input: threadInput(thread, reviewId) })
      ).pipe(Effect.tapErrorTag("GitHubNotFound", () => forget(thread.pullId)));

      return { threadId: added.addPullRequestReviewThread.thread.id, reviewId };
    });

  const reply = (input: Reply) =>
    Effect.gen(function* () {
      if (input.body.trim() === "") return yield* invalid("A reply needs some text.");

      const accountId = yield* accountFor(input.pull);
      const reviewId = yield* ensurePending(accountId, input.pullId, null);

      const added = yield* mutate(
        accountId,
        AddReplyData,
        addReply({
          input: {
            pullRequestReviewThreadId: input.threadId,
            body: input.body,
            pullRequestReviewId: reviewId,
          },
        })
      ).pipe(Effect.tapErrorTag("GitHubNotFound", () => forget(input.pullId)));

      return { commentId: added.addPullRequestReviewThreadReply.comment.id };
    });

  const resolve = (input: ThreadResolution) =>
    Effect.flatMap(accountFor(input.pull), (accountId) =>
      mutate(
        accountId,
        AnyData,
        (input.resolved ? resolveThread : unresolveThread)({ input: { threadId: input.threadId } })
      )
    ).pipe(Effect.asVoid);

  const editComment = (input: CommentEdit) =>
    Effect.flatMap(accountFor(input.pull), (accountId) =>
      input.body === null
        ? mutate(accountId, AnyData, deleteComment({ input: { id: input.commentId } }))
        : mutate(
            accountId,
            AnyData,
            updateComment({
              input: { pullRequestReviewCommentId: input.commentId, body: input.body },
            })
          )
    ).pipe(Effect.asVoid);

  const submissionProblem = (input: Submission) => {
    const roles = authors.get(input.pullId);
    const own = roles !== undefined && roles.author === roles.viewer;

    if (own && input.event === "approve") return "You can't approve your own pull request.";

    if (own && input.event === "request-changes")
      return "You can't request changes on your own pull request.";

    if (input.event === "request-changes" && input.body.trim() === "")
      return "Say what needs to change.";

    return null;
  };

  /** Submits the pending review, or a review with only a body when nothing is pending. */
  const submit = (input: Submission) =>
    Effect.gen(function* () {
      const problem = submissionProblem(input);

      if (problem !== null) return yield* invalid(problem);

      const accountId = yield* accountFor(input.pull);

      const existing =
        pending.get(input.pullId) ??
        (yield* client.graphql(accountId, PendingReviewData, pendingReview({ id: input.pullId })))
          .node?.reviews.nodes[0]?.id;

      const event = EVENTS[input.event];

      if (existing === undefined && input.event === "comment" && input.body.trim() === "") {
        return yield* invalid("Add a comment or a summary first.");
      }

      yield* existing === undefined
        ? mutate(
            accountId,
            AnyData,
            addReview({ input: { pullRequestId: input.pullId, event, body: input.body } })
          )
        : mutate(
            accountId,
            AnyData,
            submitReview({ input: { pullRequestReviewId: existing, event, body: input.body } })
          );
      pending.delete(input.pullId);
    });

  const discard = (input: Discard) =>
    Effect.gen(function* () {
      const accountId = yield* accountFor(input.pull);

      const existing =
        pending.get(input.pullId) ??
        (yield* client.graphql(accountId, PendingReviewData, pendingReview({ id: input.pullId })))
          .node?.reviews.nodes[0]?.id;

      pending.delete(input.pullId);

      if (existing !== undefined)
        yield* mutate(
          accountId,
          AnyData,
          deleteReview({ input: { pullRequestReviewId: existing } })
        );
    });

  /** Rapid toggles collapse: a queued mark sends only the latest wish, and nothing if it's already sent. */
  const setViewed = (input: ViewedMark) =>
    Effect.gen(function* () {
      const key = `${input.pullId}:${input.path}`;

      wantViewed.set(key, input.viewed);

      const accountId = yield* accountFor(input.pull);
      const lock = yield* lockOf(accountId);

      yield* lock.withPermit(
        Effect.gen(function* () {
          const want = wantViewed.get(key) ?? input.viewed;

          if (sentViewed.get(key) === want) return;
          yield* paced(
            accountId,
            AnyData,
            (want ? markViewed : unmarkViewed)({
              input: { pullRequestId: input.pullId, path: input.path },
            })
          );
          sentViewed.set(key, want);
        })
      );
    });

  return {
    detail,
    addThread: addThreadTo,
    reply,
    resolve,
    editComment,
    submit,
    discard,
    setViewed,
  };
};

export type Reviews = ReturnType<typeof newReviews>;
