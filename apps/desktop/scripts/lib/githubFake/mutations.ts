/**
 * The fake's review mutations: pending reviews, threads, replies, resolve,
 * submit (refusing what GitHub refuses), discard and Viewed marks.
 */
import { addIssueComment, publishDescription } from "./overview.ts";
import { Schema } from "effect";
import { fail, inputOf, pullById, type Resolver } from "./graphql.ts";
import {
  type FakeComment,
  type FakePull,
  type FakeReview,
  type FakeThread,
  type FakeUser,
  type ReviewState,
  type World,
  newId,
  pendingReviewOf,
} from "./world.ts";

const Side = Schema.Literals(["LEFT", "RIGHT"]);

const DraftThread = Schema.Struct({
  path: Schema.String,
  body: Schema.String,
  line: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  side: Schema.optionalKey(Schema.NullOr(Side)),
  startLine: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  startSide: Schema.optionalKey(Schema.NullOr(Side)),
  subjectType: Schema.optionalKey(Schema.NullOr(Schema.Literals(["LINE", "FILE"]))),
});

type DraftThread = typeof DraftThread.Type;

const Event = Schema.Literals(["APPROVE", "REQUEST_CHANGES", "COMMENT"]);

const input = inputOf;

const stamp = () => new Date().toISOString();

const reviewById = (world: World, viewer: FakeUser, id: string) => {
  const review = world.reviews.find((r) => r.id === id && r.author === viewer.login);

  return review ?? fail("NOT_FOUND", `Could not resolve to a node with the global id of '${id}'`);
};

const threadById = (world: World, id: string) =>
  world.threads.find((t) => t.id === id) ??
  fail("NOT_FOUND", `Could not resolve to a node with the global id of '${id}'`);

const comment = (
  world: World,
  review: FakeReview,
  viewer: FakeUser,
  body: string
): FakeComment => ({
  id: newId(world, "PRRC"),
  reviewId: review.id,
  author: viewer.login,
  body,
  createdAt: stamp(),
});

const addDraftThread = (world: World, review: FakeReview, viewer: FakeUser, draft: DraftThread) => {
  const pull = pullById(world, viewer, review.pullId);
  const subjectType = draft.subjectType ?? "LINE";
  const line = draft.line ?? null;

  if (!pull.files.some((f) => f.path === draft.path))
    fail("UNPROCESSABLE", "Path could not be resolved");

  if (subjectType === "LINE" && line === null) fail("UNPROCESSABLE", "Line could not be resolved");

  const side = draft.side ?? "RIGHT";
  const startLine = draft.startLine ?? null;

  const thread: FakeThread = {
    id: newId(world, "PRRT"),
    pullId: pull.id,
    path: draft.path,
    line: subjectType === "FILE" ? null : line,
    startLine,
    originalLine: subjectType === "FILE" ? null : line,
    originalStartLine: startLine,
    side,
    startSide: startLine === null ? null : (draft.startSide ?? side),
    subjectType,
    isResolved: false,
    originalCommit: review.commitOid,
    diffHunk: `@@ ${draft.path} @@`,
    comments: [comment(world, review, viewer, draft.body)],
  };

  world.threads.push(thread);

  return thread;
};

const SUBMITTED: Readonly<Record<typeof Event.Type, ReviewState>> = {
  APPROVE: "APPROVED",
  REQUEST_CHANGES: "CHANGES_REQUESTED",
  COMMENT: "COMMENTED",
};

const submit = (
  pull: FakePull,
  review: FakeReview,
  viewer: FakeUser,
  event: typeof Event.Type,
  body: string
) => {
  if (event !== "COMMENT" && pull.author === viewer.login) {
    fail(
      "UNPROCESSABLE",
      `Can not ${event === "APPROVE" ? "approve" : "request changes on"} your own pull request`
    );
  }

  if (event === "REQUEST_CHANGES" && body.trim() === "")
    fail("UNPROCESSABLE", "Review body is required");

  review.state = SUBMITTED[event];
  review.body = body;
  review.submittedAt = stamp();
  pull.reviewRequests = pull.reviewRequests.filter((login) => login !== viewer.login);

  if (event === "APPROVE") pull.reviewDecision = "APPROVED";

  if (event === "REQUEST_CHANGES") pull.reviewDecision = "CHANGES_REQUESTED";
};

const newReview = (
  world: World,
  pull: FakePull,
  viewer: FakeUser,
  commitOid: string | null
): FakeReview => {
  if (pendingReviewOf(world, pull.id, viewer) !== undefined) {
    fail("UNPROCESSABLE", "User can only have one pending review per pull request");
  }

  const review: FakeReview = {
    id: newId(world, "PRR"),
    pullId: pull.id,
    author: viewer.login,
    state: "PENDING",
    commitOid: commitOid ?? pull.headRefOid,
    body: "",
    submittedAt: null,
  };

  world.reviews.push(review);

  return review;
};

const addReview: Resolver = (world, viewer, variables) => {
  const args = input(
    Schema.Struct({
      pullRequestId: Schema.String,
      commitOID: Schema.optionalKey(Schema.NullOr(Schema.String)),
      body: Schema.optionalKey(Schema.NullOr(Schema.String)),
      event: Schema.optionalKey(Schema.NullOr(Event)),
      threads: Schema.optionalKey(Schema.NullOr(Schema.Array(DraftThread))),
    }),
    variables
  );

  const pull = pullById(world, viewer, args.pullRequestId);
  const review = newReview(world, pull, viewer, args.commitOID ?? null);

  for (const draft of args.threads ?? []) addDraftThread(world, review, viewer, draft);

  if (args.event !== undefined && args.event !== null)
    submit(pull, review, viewer, args.event, args.body ?? "");

  return { addPullRequestReview: { pullRequestReview: { id: review.id } } };
};

const pendingFor = (
  world: World,
  viewer: FakeUser,
  reviewId: string | null,
  pullId: string | null
) => {
  if (reviewId !== null) return reviewById(world, viewer, reviewId);

  const pull = pullById(world, viewer, pullId ?? "");

  return pendingReviewOf(world, pull.id, viewer) ?? newReview(world, pull, viewer, null);
};

const addThread: Resolver = (world, viewer, variables) => {
  const {
    pullRequestReviewId = null,
    pullRequestId = null,
    ...draft
  } = input(
    Schema.Struct({
      ...DraftThread.fields,
      pullRequestReviewId: Schema.optionalKey(Schema.NullOr(Schema.String)),
      pullRequestId: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
    variables
  );

  const review = pendingFor(world, viewer, pullRequestReviewId, pullRequestId);

  return {
    addPullRequestReviewThread: { thread: { id: addDraftThread(world, review, viewer, draft).id } },
  };
};

const addReply: Resolver = (world, viewer, variables) => {
  const args = input(
    Schema.Struct({
      pullRequestReviewThreadId: Schema.String,
      body: Schema.String,
      pullRequestReviewId: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
    variables
  );

  const thread = threadById(world, args.pullRequestReviewThreadId);
  const review = pendingFor(world, viewer, args.pullRequestReviewId ?? null, thread.pullId);
  const reply = comment(world, review, viewer, args.body);

  thread.comments.push(reply);

  return { addPullRequestReviewThreadReply: { comment: { id: reply.id } } };
};

const setResolved =
  (resolved: boolean, field: string): Resolver =>
  (world, _viewer, variables) => {
    const thread = threadById(
      world,
      input(Schema.Struct({ threadId: Schema.String }), variables).threadId
    );

    thread.isResolved = resolved;

    return { [field]: { thread: { id: thread.id } } };
  };

const ownComment = (world: World, viewer: FakeUser, id: string) => {
  for (const thread of world.threads) {
    const found = thread.comments.find((c) => c.id === id && c.author === viewer.login);

    if (found !== undefined) return { thread, found };
  }

  return fail("NOT_FOUND", `Could not resolve to a node with the global id of '${id}'`);
};

const updateComment: Resolver = (world, viewer, variables) => {
  const args = input(
    Schema.Struct({ pullRequestReviewCommentId: Schema.String, body: Schema.String }),
    variables
  );

  const { found } = ownComment(world, viewer, args.pullRequestReviewCommentId);

  found.body = args.body;

  return { updatePullRequestReviewComment: { pullRequestReviewComment: { id: found.id } } };
};

const removeEmptyThreads = (world: World) => {
  for (let i = world.threads.length - 1; i >= 0; i -= 1) {
    if (world.threads[i]?.comments.length === 0) world.threads.splice(i, 1);
  }
};

const deleteComment: Resolver = (world, viewer, variables) => {
  const { id } = input(Schema.Struct({ id: Schema.String }), variables);
  const { thread, found } = ownComment(world, viewer, id);

  thread.comments.splice(thread.comments.indexOf(found), 1);
  removeEmptyThreads(world);

  return { deletePullRequestReviewComment: { pullRequestReview: { id: found.reviewId ?? "" } } };
};

const submitReview: Resolver = (world, viewer, variables) => {
  const args = input(
    Schema.Struct({
      pullRequestReviewId: Schema.String,
      event: Event,
      body: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
    variables
  );

  const review = reviewById(world, viewer, args.pullRequestReviewId);

  if (review.state !== "PENDING") fail("UNPROCESSABLE", "The review was already submitted");
  submit(pullById(world, viewer, review.pullId), review, viewer, args.event, args.body ?? "");

  return { submitPullRequestReview: { pullRequestReview: { id: review.id } } };
};

const deleteReview: Resolver = (world, viewer, variables) => {
  const review = reviewById(
    world,
    viewer,
    input(Schema.Struct({ pullRequestReviewId: Schema.String }), variables).pullRequestReviewId
  );

  if (review.state !== "PENDING") fail("UNPROCESSABLE", "Only a pending review can be deleted");
  world.reviews.splice(world.reviews.indexOf(review), 1);

  for (const thread of world.threads) {
    thread.comments.splice(
      0,
      thread.comments.length,
      ...thread.comments.filter((c) => c.reviewId !== review.id)
    );
  }

  removeEmptyThreads(world);

  return { deletePullRequestReview: { pullRequestReview: { id: review.id } } };
};

const setViewed =
  (viewed: boolean, field: string): Resolver =>
  (world, viewer, variables) => {
    const args = input(
      Schema.Struct({ pullRequestId: Schema.String, path: Schema.String }),
      variables
    );

    const pull = pullById(world, viewer, args.pullRequestId);
    const key = `${pull.id}:${viewer.login}:${args.path}`;

    if (!pull.files.some((f) => f.path === args.path))
      fail("UNPROCESSABLE", "Path could not be resolved");

    if (viewed) world.viewed.set(key, "VIEWED");
    else world.viewed.delete(key);

    return { [field]: { clientMutationId: null } };
  };

export const MUTATIONS = new Map<string, Resolver>([
  ["AddIssueComment", addIssueComment],
  ["PublishDescription", publishDescription],
  ["AddPullRequestReview", addReview],
  ["AddPullRequestReviewThread", addThread],
  ["AddPullRequestReviewThreadReply", addReply],
  ["ResolveReviewThread", setResolved(true, "resolveReviewThread")],
  ["UnresolveReviewThread", setResolved(false, "unresolveReviewThread")],
  ["UpdatePullRequestReviewComment", updateComment],
  ["DeletePullRequestReviewComment", deleteComment],
  ["SubmitPullRequestReview", submitReview],
  ["DeletePullRequestReview", deleteReview],
  ["MarkFileAsViewed", setViewed(true, "markFileAsViewed")],
  ["UnmarkFileAsViewed", setViewed(false, "unmarkFileAsViewed")],
]);
