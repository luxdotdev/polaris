/**
 * Every GraphQL operation the client sends, with a Schema for its `data`. Field and
 * argument names follow GitHub's published schema (docs/research/github-review-apis.md §6).
 */
import { Schema } from "effect";
import type { GraphQLRequest, Json } from "./transport.ts";

const op = (operationName: string, query: string) => (variables: { readonly [k: string]: Json }) =>
  ({ operationName, query, variables }) satisfies GraphQLRequest;

const PageInfo = Schema.Struct({
  hasNextPage: Schema.Boolean,
  endCursor: Schema.NullOr(Schema.String),
});

const Author = Schema.NullOr(Schema.Struct({ login: Schema.String, avatarUrl: Schema.String }));

// ── Repositories ─────────────────────────────────────────────────────────────

export const probeRepo = op(
  "ProbeRepo",
  `query ProbeRepo($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name, followRenames: true) { id nameWithOwner isArchived viewerPermission }
}`
);

export const ProbeRepoData = Schema.Struct({
  repository: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      nameWithOwner: Schema.String,
      isArchived: Schema.Boolean,
      viewerPermission: Schema.NullOr(Schema.String),
    })
  ),
});

export const ownerKind = op(
  "OwnerKind",
  `query OwnerKind($login: String!) { repositoryOwner(login: $login) { __typename } }`
);

export const OwnerKindData = Schema.Struct({
  repositoryOwner: Schema.NullOr(Schema.Struct({ __typename: Schema.String })),
});

// ── Checks and stacks ────────────────────────────────────────────────────────

/** The head commit's checks; `contexts` needs a page size, and only its total is read. */
const CHECKS = `commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 1) { totalCount } } } } }`;

const Checks = Schema.Struct({
  nodes: Schema.Array(
    Schema.Struct({
      commit: Schema.Struct({
        statusCheckRollup: Schema.NullOr(
          Schema.Struct({
            state: Schema.String,
            contexts: Schema.Struct({ totalCount: Schema.Number }),
          })
        ),
      }),
    })
  ),
});

/** Stacks larger than this show their first layers only. */
export const STACK_ENTRIES = 20;

/**
 * GitHub's stack of a pull request (docs/research/github-stacks.md). github.com only: an
 * Enterprise Server without the fields would refuse the whole query.
 */
const STACK = `stackEntry { position }
stack { number size baseRefName entries(first: ${STACK_ENTRIES}) { nodes { position pullRequest {
  id number title url headRefName state isDraft additions deletions ${CHECKS}
} } } }`;

const StackMember = Schema.Struct({
  id: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  headRefName: Schema.String,
  state: Schema.String,
  isDraft: Schema.Boolean,
  additions: Schema.Number,
  deletions: Schema.Number,
  commits: Checks,
});

export type StackMember = typeof StackMember.Type;

const StackFields = {
  stackEntry: Schema.optionalKey(Schema.NullOr(Schema.Struct({ position: Schema.Number }))),
  stack: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        number: Schema.Number,
        size: Schema.Number,
        baseRefName: Schema.String,
        entries: Schema.Struct({
          nodes: Schema.Array(
            Schema.Struct({ position: Schema.Number, pullRequest: Schema.NullOr(StackMember) })
          ),
        }),
      })
    )
  ),
};

export type GitHubStack = NonNullable<Schema.Struct<typeof StackFields>["Type"]["stack"]>;

export type ChecksData = typeof Checks.Type;

// ── The pull request list ────────────────────────────────────────────────────

/** `stacks`: ask for GitHub's stacks (github.com); Enterprise hosts infer them instead. */
export const pullSearch = (variables: { readonly q: string }, stacks: boolean) =>
  op(
    "PullSearch",
    `query PullSearch($q: String!) {
  search(type: ISSUE, query: $q, first: 50) {
    issueCount
    nodes {
      ... on PullRequest {
        id number title url isDraft state updatedAt isCrossRepository
        headRefName headRefOid baseRefName additions deletions
        ${CHECKS}
        ${stacks ? STACK : ""}
        repository { nameWithOwner }
        author { login avatarUrl }
        reviewDecision
        reviewRequests(first: 10) { nodes { requestedReviewer { __typename ... on User { login } ... on Team { slug } } } }
        viewerLatestReview { state }
      }
    }
  }
  rateLimit { cost remaining resetAt }
}`
  )(variables);

export const SearchPull = Schema.Struct({
  id: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  isDraft: Schema.Boolean,
  state: Schema.String,
  updatedAt: Schema.String,
  headRefName: Schema.String,
  headRefOid: Schema.String,
  baseRefName: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  isCrossRepository: Schema.optionalKey(Schema.Boolean),
  commits: Schema.optionalKey(Checks),
  ...StackFields,
  repository: Schema.Struct({ nameWithOwner: Schema.String }),
  author: Author,
  reviewDecision: Schema.NullOr(Schema.String),
  reviewRequests: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        requestedReviewer: Schema.NullOr(
          Schema.Struct({
            __typename: Schema.String,
            login: Schema.optionalKey(Schema.String),
            slug: Schema.optionalKey(Schema.String),
          })
        ),
      })
    ),
  }),
  viewerLatestReview: Schema.NullOr(Schema.Struct({ state: Schema.String })),
});

export type SearchPull = typeof SearchPull.Type;

export const PullSearchData = Schema.Struct({
  search: Schema.Struct({ issueCount: Schema.Number, nodes: Schema.Array(SearchPull) }),
});

// ── One pull request ─────────────────────────────────────────────────────────

const FILES = `pageInfo { hasNextPage endCursor } nodes { path additions deletions changeType viewerViewedState }`;

const THREADS = `pageInfo { hasNextPage endCursor }
nodes {
  id path isResolved isOutdated resolvedBy { login } subjectType line startLine originalLine originalStartLine diffSide startDiffSide
  comments(first: 100) { nodes { id body createdAt url state diffHunk author { login avatarUrl __typename } originalCommit { oid } } }
}`;

const PENDING = `reviews(states: [PENDING], first: 1) { nodes { id commit { oid } comments { totalCount } } }`;

/** `stacks` as for `pullSearch`. */
export const pullDetail = (
  variables: { readonly owner: string; readonly name: string; readonly number: number },
  stacks: boolean
) =>
  op(
    "PullDetail",
    `query PullDetail($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    nameWithOwner
    pullRequest(number: $number) {
      id number title body url state isDraft
      author { login avatarUrl }
      headRefName headRefOid baseRefName baseRefOid
      commits { totalCount }
      checks: ${CHECKS}
      ${stacks ? STACK : ""}
      files(first: 100) { ${FILES} }
      reviewThreads(first: 100) { ${THREADS} }
      ${PENDING}
    }
  }
}`
  )(variables);

export const PullFile = Schema.Struct({
  path: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  changeType: Schema.String,
  viewerViewedState: Schema.String,
});

export const FilesPage = Schema.Struct({ pageInfo: PageInfo, nodes: Schema.Array(PullFile) });

export const ReviewComment = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
  createdAt: Schema.String,
  url: Schema.String,
  state: Schema.String,
  diffHunk: Schema.String,
  author: Schema.NullOr(
    Schema.Struct({
      login: Schema.String,
      avatarUrl: Schema.optionalKey(Schema.String),
      __typename: Schema.optionalKey(Schema.String),
    })
  ),
  originalCommit: Schema.NullOr(Schema.Struct({ oid: Schema.String })),
});

export const ReviewThread = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  isResolved: Schema.Boolean,
  isOutdated: Schema.Boolean,
  resolvedBy: Schema.optionalKey(Schema.NullOr(Schema.Struct({ login: Schema.String }))),
  subjectType: Schema.String,
  line: Schema.NullOr(Schema.Number),
  startLine: Schema.NullOr(Schema.Number),
  originalLine: Schema.NullOr(Schema.Number),
  originalStartLine: Schema.NullOr(Schema.Number),
  diffSide: Schema.String,
  startDiffSide: Schema.NullOr(Schema.String),
  comments: Schema.Struct({ nodes: Schema.Array(ReviewComment) }),
});

export type ReviewThread = typeof ReviewThread.Type;

export const ThreadsPage = Schema.Struct({ pageInfo: PageInfo, nodes: Schema.Array(ReviewThread) });

const PendingReviews = Schema.Struct({
  nodes: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      commit: Schema.NullOr(Schema.Struct({ oid: Schema.String })),
      comments: Schema.Struct({ totalCount: Schema.Number }),
    })
  ),
});

export const PullDetailData = Schema.Struct({
  viewer: Schema.Struct({ login: Schema.String }),
  repository: Schema.NullOr(
    Schema.Struct({
      nameWithOwner: Schema.String,
      pullRequest: Schema.NullOr(
        Schema.Struct({
          id: Schema.String,
          number: Schema.Number,
          title: Schema.String,
          body: Schema.String,
          url: Schema.String,
          state: Schema.String,
          isDraft: Schema.Boolean,
          author: Author,
          headRefName: Schema.String,
          headRefOid: Schema.String,
          baseRefName: Schema.String,
          baseRefOid: Schema.String,
          commits: Schema.Struct({ totalCount: Schema.Number }),
          checks: Schema.optionalKey(Checks),
          ...StackFields,
          files: FilesPage,
          reviewThreads: ThreadsPage,
          reviews: PendingReviews,
        })
      ),
    })
  ),
});

export type PullDetailData = typeof PullDetailData.Type;

export const pullFiles = op(
  "PullFiles",
  `query PullFiles($id: ID!, $after: String) {
  node(id: $id) { ... on PullRequest { files(first: 100, after: $after) { ${FILES} } } }
}`
);

export const PullFilesData = Schema.Struct({
  node: Schema.NullOr(Schema.Struct({ files: FilesPage })),
});

export const pullThreads = op(
  "PullThreads",
  `query PullThreads($id: ID!, $after: String) {
  node(id: $id) { ... on PullRequest { reviewThreads(first: 100, after: $after) { ${THREADS} } } }
}`
);

export const PullThreadsData = Schema.Struct({
  node: Schema.NullOr(Schema.Struct({ reviewThreads: ThreadsPage })),
});

export const pendingReview = op(
  "PendingReview",
  `query PendingReview($id: ID!) { node(id: $id) { ... on PullRequest { ${PENDING} } } }`
);

export const PendingReviewData = Schema.Struct({
  node: Schema.NullOr(Schema.Struct({ reviews: PendingReviews })),
});

/** Every Review Checkout's pull request in one call: about one point for up to 100 ids. */
export const pullStates = op(
  "PullStates",
  `query PullStates($ids: [ID!]!) {
  nodes(ids: $ids) { ... on PullRequest { id state headRefOid mergedAt closedAt } }
}`
);

export const PullStatesData = Schema.Struct({
  nodes: Schema.Array(
    Schema.NullOr(
      Schema.Struct({
        id: Schema.String,
        state: Schema.String,
        headRefOid: Schema.String,
        mergedAt: Schema.NullOr(Schema.String),
        closedAt: Schema.NullOr(Schema.String),
      })
    )
  ),
});

// ── Mutations ────────────────────────────────────────────────────────────────

const ReviewRef = Schema.Struct({ id: Schema.String });

const mutation = (name: string, field: string, selection: string) =>
  op(name, `mutation ${name}($input: ${name}Input!) { ${field}(input: $input) { ${selection} } }`);

export const addReview = mutation(
  "AddPullRequestReview",
  "addPullRequestReview",
  "pullRequestReview { id }"
);

export const AddReviewData = Schema.Struct({
  addPullRequestReview: Schema.Struct({ pullRequestReview: ReviewRef }),
});

export const addThread = mutation(
  "AddPullRequestReviewThread",
  "addPullRequestReviewThread",
  "thread { id }"
);

export const AddThreadData = Schema.Struct({
  addPullRequestReviewThread: Schema.Struct({ thread: ReviewRef }),
});

export const addReply = mutation(
  "AddPullRequestReviewThreadReply",
  "addPullRequestReviewThreadReply",
  "comment { id }"
);

export const AddReplyData = Schema.Struct({
  addPullRequestReviewThreadReply: Schema.Struct({ comment: ReviewRef }),
});

export const resolveThread = mutation(
  "ResolveReviewThread",
  "resolveReviewThread",
  "thread { id }"
);

export const unresolveThread = mutation(
  "UnresolveReviewThread",
  "unresolveReviewThread",
  "thread { id }"
);

export const updateComment = mutation(
  "UpdatePullRequestReviewComment",
  "updatePullRequestReviewComment",
  "pullRequestReviewComment { id }"
);

export const deleteComment = mutation(
  "DeletePullRequestReviewComment",
  "deletePullRequestReviewComment",
  "pullRequestReview { id }"
);

export const submitReview = mutation(
  "SubmitPullRequestReview",
  "submitPullRequestReview",
  "pullRequestReview { id }"
);

export const deleteReview = mutation(
  "DeletePullRequestReview",
  "deletePullRequestReview",
  "pullRequestReview { id }"
);

export const markViewed = mutation("MarkFileAsViewed", "markFileAsViewed", "clientMutationId");

export const unmarkViewed = mutation(
  "UnmarkFileAsViewed",
  "unmarkFileAsViewed",
  "clientMutationId"
);

/** For mutations whose answer Polaris doesn't read. */
export const AnyData = Schema.Unknown;
