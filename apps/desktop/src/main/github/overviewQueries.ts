/** Paginated Overview data fetched with PR detail, never on a hover. */
import { Schema } from "effect";
import type { GraphQLRequest, Json } from "./transport.ts";

const PageInfo = Schema.Struct({
  hasNextPage: Schema.Boolean,
  endCursor: Schema.NullOr(Schema.String),
});

export const Person = Schema.NullOr(
  Schema.Struct({
    login: Schema.String,
    avatarUrl: Schema.optionalKey(Schema.String),
    __typename: Schema.optionalKey(Schema.String),
  })
);

const page = <S extends Schema.Top>(node: S) =>
  Schema.Struct({ pageInfo: PageInfo, nodes: Schema.Array(node) });

export const IssueComment = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  url: Schema.String,
  author: Person,
});

export const SubmittedReview = Schema.Struct({
  id: Schema.String,
  body: Schema.String,
  state: Schema.String,
  submittedAt: Schema.NullOr(Schema.String),
  url: Schema.String,
  author: Person,
  commit: Schema.NullOr(Schema.Struct({ oid: Schema.String })),
});

const Rollup = Schema.NullOr(
  Schema.Struct({ state: Schema.String, contexts: Schema.Struct({ totalCount: Schema.Number }) })
);

export const OverviewCommit = Schema.Struct({
  commit: Schema.Struct({
    oid: Schema.String,
    messageHeadline: Schema.String,
    messageBody: Schema.String,
    committedDate: Schema.String,
    url: Schema.String,
    author: Schema.NullOr(Schema.Struct({ name: Schema.NullOr(Schema.String), user: Person })),
    statusCheckRollup: Rollup,
  }),
});

export const CheckContext = Schema.Struct({
  __typename: Schema.String,
  name: Schema.optionalKey(Schema.String),
  context: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  state: Schema.optionalKey(Schema.String),
  conclusion: Schema.optionalKey(Schema.NullOr(Schema.String)),
  startedAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  completedAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
  detailsUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
  targetUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
  checkSuite: Schema.optionalKey(
    Schema.Struct({
      workflowRun: Schema.NullOr(
        Schema.Struct({ workflow: Schema.Struct({ name: Schema.String }) })
      ),
    })
  ),
});

export const OverviewPull = Schema.Struct({
  comments: page(IssueComment),
  submittedReviews: page(SubmittedReview),
  commitList: page(OverviewCommit),
  headChecks: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        commit: Schema.Struct({
          statusCheckRollup: Schema.NullOr(Schema.Struct({ contexts: page(CheckContext) })),
        }),
      })
    ),
  }),
});

export const PullOverviewData = Schema.Struct({ node: Schema.NullOr(OverviewPull) });

export type OverviewPull = typeof OverviewPull.Type;

export const pullOverview = (variables: { readonly [key: string]: Json }): GraphQLRequest => ({
  operationName: "PullOverview",
  variables,
  query: `query PullOverview($id: ID!, $comments: String, $reviews: String, $commits: String, $checks: String) {
    node(id: $id) { ... on PullRequest {
      comments(first:100, after:$comments) { pageInfo { hasNextPage endCursor } nodes { id body createdAt updatedAt url author { login avatarUrl __typename } } }
      submittedReviews: reviews(first:100, after:$reviews) { pageInfo { hasNextPage endCursor } nodes { id body state submittedAt url commit { oid } author { login avatarUrl __typename } } }
      commitList: commits(first:100, after:$commits) { pageInfo { hasNextPage endCursor } nodes { commit { oid messageHeadline messageBody committedDate url author { name user { login avatarUrl __typename } } statusCheckRollup { state contexts(first:1) { totalCount } } } } }
      headChecks: commits(last:1) { nodes { commit { statusCheckRollup { contexts(first:100, after:$checks) { pageInfo { hasNextPage endCursor } nodes {
        __typename ... on CheckRun { name status conclusion startedAt completedAt detailsUrl checkSuite { workflowRun { workflow { name } } } }
        ... on StatusContext { context state targetUrl }
      } } } } } }
    } }
  }`,
});
