/**
 * The GraphQL and REST shapes behind reviewer requests and merging (ENG-228, ENG-229). Field
 * names follow GitHub's published schema and REST docs (docs/research/github-review-apis.md).
 */
import { Schema } from "effect";
import type { GraphQLRequest, Json } from "./transport.ts";

const op = (operationName: string, query: string) => (variables: { readonly [k: string]: Json }) =>
  ({ operationName, query, variables }) satisfies GraphQLRequest;

const Login = Schema.Struct({ login: Schema.String });

/** Users, teams, bots and mannequins can each be asked; only users and teams by Polaris. */
const RequestedReviewer = Schema.NullOr(
  Schema.Struct({
    __typename: Schema.String,
    login: Schema.optionalKey(Schema.String),
    slug: Schema.optionalKey(Schema.String),
    name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  })
);

const Context = Schema.Struct({
  __typename: Schema.String,
  status: Schema.optionalKey(Schema.String),
  conclusion: Schema.optionalKey(Schema.NullOr(Schema.String)),
  state: Schema.optionalKey(Schema.String),
});

export type CheckContext = typeof Context.Type;

const CONTEXTS = `contexts(first: 100) { totalCount nodes { __typename ... on CheckRun { status conclusion } ... on StatusContext { state } } }`;

export const pullActions = op(
  "PullActions",
  `query PullActions($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    nameWithOwner viewerPermission viewerDefaultMergeMethod
    mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed autoMergeAllowed deleteBranchOnMerge
    defaultBranchRef { name }
    pullRequest(number: $number) {
      id number state isDraft mergeable mergeStateStatus reviewDecision
      headRefName headRefOid baseRefName isCrossRepository
      author { login }
      headRepository { nameWithOwner viewerPermission defaultBranchRef { name } }
      headRef { name }
      viewerCanEnableAutoMerge
      autoMergeRequest { mergeMethod enabledBy { login } }
      mergeTitle: viewerMergeHeadlineText(mergeType: MERGE)
      mergeBody: viewerMergeBodyText(mergeType: MERGE)
      squashTitle: viewerMergeHeadlineText(mergeType: SQUASH)
      squashBody: viewerMergeBodyText(mergeType: SQUASH)
      commits(last: 1) { nodes { commit { statusCheckRollup { state ${CONTEXTS} } } } }
      reviewRequests(first: 50) { nodes { requestedReviewer { __typename ... on User { login name } ... on Team { slug name } ... on Bot { login } ... on Mannequin { login } } } }
      latestReviews(first: 50) { nodes { author { login } state submittedAt } }
      suggestedReviewers { reviewer { login name } }
    }
  }
}`
);

const ActionsPull = Schema.Struct({
  id: Schema.String,
  number: Schema.Number,
  state: Schema.String,
  isDraft: Schema.Boolean,
  mergeable: Schema.String,
  mergeStateStatus: Schema.String,
  reviewDecision: Schema.NullOr(Schema.String),
  headRefName: Schema.String,
  headRefOid: Schema.String,
  baseRefName: Schema.String,
  isCrossRepository: Schema.Boolean,
  author: Schema.NullOr(Login),
  headRepository: Schema.NullOr(
    Schema.Struct({
      nameWithOwner: Schema.String,
      viewerPermission: Schema.NullOr(Schema.String),
      defaultBranchRef: Schema.NullOr(Schema.Struct({ name: Schema.String })),
    })
  ),
  headRef: Schema.NullOr(Schema.Struct({ name: Schema.String })),
  viewerCanEnableAutoMerge: Schema.Boolean,
  autoMergeRequest: Schema.NullOr(
    Schema.Struct({ mergeMethod: Schema.String, enabledBy: Schema.NullOr(Login) })
  ),
  mergeTitle: Schema.String,
  mergeBody: Schema.String,
  squashTitle: Schema.String,
  squashBody: Schema.String,
  commits: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        commit: Schema.Struct({
          statusCheckRollup: Schema.NullOr(
            Schema.Struct({
              state: Schema.String,
              contexts: Schema.Struct({
                totalCount: Schema.Number,
                nodes: Schema.Array(Context),
              }),
            })
          ),
        }),
      })
    ),
  }),
  reviewRequests: Schema.Struct({
    nodes: Schema.Array(Schema.Struct({ requestedReviewer: RequestedReviewer })),
  }),
  latestReviews: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        author: Schema.NullOr(Login),
        state: Schema.String,
        submittedAt: Schema.NullOr(Schema.String),
      })
    ),
  }),
  suggestedReviewers: Schema.Array(
    Schema.Struct({
      reviewer: Schema.Struct({ login: Schema.String, name: Schema.NullOr(Schema.String) }),
    })
  ),
});

export type ActionsPull = typeof ActionsPull.Type;

const ActionsRepo = Schema.Struct({
  nameWithOwner: Schema.String,
  viewerPermission: Schema.NullOr(Schema.String),
  viewerDefaultMergeMethod: Schema.String,
  mergeCommitAllowed: Schema.Boolean,
  squashMergeAllowed: Schema.Boolean,
  rebaseMergeAllowed: Schema.Boolean,
  autoMergeAllowed: Schema.Boolean,
  deleteBranchOnMerge: Schema.Boolean,
  defaultBranchRef: Schema.NullOr(Schema.Struct({ name: Schema.String })),
  pullRequest: Schema.NullOr(ActionsPull),
});

export type ActionsRepo = typeof ActionsRepo.Type;

export const PullActionsData = Schema.Struct({
  viewer: Login,
  repository: Schema.NullOr(ActionsRepo),
});

/** Collaborators who can be assigned (GitHub's reviewer picker reads the same) and the org's teams. */
export const reviewerSearch = op(
  "ReviewerSearch",
  `query ReviewerSearch($owner: String!, $name: String!, $q: String!) {
  repository(owner: $owner, name: $name) {
    assignableUsers(first: 20, query: $q) { nodes { login name } }
    owner { __typename ... on Organization { teams(first: 20, query: $q) { nodes { slug name } } } }
  }
}`
);

export const ReviewerSearchData = Schema.Struct({
  repository: Schema.NullOr(
    Schema.Struct({
      assignableUsers: Schema.Struct({
        nodes: Schema.Array(
          Schema.Struct({ login: Schema.String, name: Schema.NullOr(Schema.String) })
        ),
      }),
      owner: Schema.Struct({
        __typename: Schema.String,
        teams: Schema.optionalKey(
          Schema.Struct({
            nodes: Schema.Array(Schema.Struct({ slug: Schema.String, name: Schema.String })),
          })
        ),
      }),
    })
  ),
});

const mutation = (name: string, field: string, selection: string) =>
  op(name, `mutation ${name}($input: ${name}Input!) { ${field}(input: $input) { ${selection} } }`);

export const mergePull = mutation(
  "MergePullRequest",
  "mergePullRequest",
  "pullRequest { id state mergedAt }"
);

export const MergePullData = Schema.Struct({
  mergePullRequest: Schema.Struct({
    pullRequest: Schema.Struct({
      id: Schema.String,
      state: Schema.String,
      mergedAt: Schema.NullOr(Schema.String),
    }),
  }),
});

export const enableAutoMerge = mutation(
  "EnablePullRequestAutoMerge",
  "enablePullRequestAutoMerge",
  "pullRequest { id }"
);

export const disableAutoMerge = mutation(
  "DisablePullRequestAutoMerge",
  "disablePullRequestAutoMerge",
  "pullRequest { id }"
);

/** `GET /repos/{o}/{r}/branches/{branch}`: readable with read access, unlike its rules. */
export const BranchData = Schema.Struct({ name: Schema.String, protected: Schema.Boolean });

/** REST answers Polaris doesn't read (a pull request after a review request, a new ref). */
export const Ignored = Schema.Unknown;

/** A branch name as a URL path: each segment encoded, the slashes kept (GitHub's refs keep them). */
export const branchPath = (name: string) => name.split("/").map(encodeURIComponent).join("/");
