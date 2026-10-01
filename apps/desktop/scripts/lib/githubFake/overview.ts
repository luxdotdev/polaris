/** Overview fixture and the paginated query; every bot command stays in this world. */
import { readFileSync } from "node:fs";
import { Schema } from "effect";
import { author, inputOf, page, pullById, type Resolver, vars } from "./graphql.ts";
import { newId, type World } from "./world.ts";

export const seedOverview = (world: World) => {
  const pull = world.pulls.find((p) => p.repo === "acme/widgets" && p.number === 42);

  if (pull === undefined) return;
  const at = "2026-10-01T10:00:00Z";

  const sample = readFileSync(new URL("./fixtures/suzuka.md", import.meta.url), "utf8")
    .replaceAll("a".repeat(40), pull.headRefOid)
    .replaceAll("b".repeat(40), pull.baseRefOid);

  world.issueComments.set(pull.id, [
    {
      id: "IC_human",
      author: "mona",
      body: "Please check the expiry path.",
      createdAt: at,
      updatedAt: at,
    },
    { id: "IC_suzuka", author: "suzuka[bot]", body: sample, createdAt: at, updatedAt: at },
  ]);
  world.reviews.push({
    id: "R_approved",
    pullId: pull.id,
    author: "mona",
    state: "APPROVED",
    commitOid: pull.headRefOid,
    body: "Thanks for catching expiry.",
    submittedAt: at,
  });
  world.threads.push({
    id: "T_suzuka",
    pullId: pull.id,
    path: pull.files[0]?.path ?? "feature.ts",
    line: 1,
    startLine: null,
    originalLine: 1,
    originalStartLine: null,
    side: "RIGHT",
    startSide: null,
    subjectType: "LINE",
    isResolved: false,
    originalCommit: pull.headRefOid,
    diffHunk: "@@ -1 +1 @@\n-old\n+new",
    comments: [
      {
        id: "C_suzuka",
        reviewId: null,
        author: "suzuka[bot]",
        body: "The expiry path writes no stop event.",
        createdAt: at,
      },
    ],
  });
  world.checkRuns.set(pull.id, [
    {
      name: "typecheck",
      workflow: "CI",
      status: "COMPLETED",
      conclusion: "SUCCESS",
      startedAt: at,
      completedAt: "2026-10-01T10:01:00Z",
      url: "https://github.test/check/1",
    },
  ]);
};

const Input = Schema.Struct({
  id: Schema.String,
  comments: Schema.NullOr(Schema.String),
  reviews: Schema.NullOr(Schema.String),
  commits: Schema.NullOr(Schema.String),
  checks: Schema.NullOr(Schema.String),
});

export const overviewQuery: Resolver = (world, viewer, variables) => {
  const input = vars(Input, variables);
  const pull = pullById(world, viewer, input.id);

  const comments = (world.issueComments.get(pull.id) ?? []).map((c) => ({
    ...c,
    author: author(world, c.author),
    url: `https://github.test/${pull.repo}/pull/${pull.number}#${c.id}`,
  }));

  const reviews = world.reviews
    .filter((r) => r.pullId === pull.id && (r.state !== "PENDING" || r.author === viewer.login))
    .map((r) => ({
      ...r,
      author: author(world, r.author),
      commit: { oid: r.commitOid },
      url: `https://github.test/review/${r.id}`,
    }));

  const commits = (world.commits.get(pull.id) ?? []).map((c) => ({
    commit: {
      oid: c.oid,
      messageHeadline: c.message.split("\n")[0] ?? "",
      messageBody: c.message.split("\n").slice(1).join("\n"),
      committedDate: c.date,
      url: `https://github.test/commit/${c.oid}`,
      author: { name: pull.author, user: author(world, pull.author) },
      statusCheckRollup:
        pull.checks === undefined
          ? null
          : { state: pull.checks.state, contexts: { totalCount: pull.checks.total } },
    },
  }));

  const checks = (world.checkRuns.get(pull.id) ?? []).map((c) => ({
    __typename: "CheckRun",
    ...c,
    detailsUrl: c.url,
    checkSuite: { workflowRun: c.workflow === null ? null : { workflow: { name: c.workflow } } },
  }));

  return {
    node: {
      comments: page(comments, input.comments),
      submittedReviews: page(reviews, input.reviews),
      commitList: page(commits, input.commits),
      headChecks: {
        nodes: [{ commit: { statusCheckRollup: { contexts: page(checks, input.checks) } } }],
      },
    },
  };
};

export const addIssueComment: Resolver = (world, viewer, variables) => {
  const input = inputOf(
    Schema.Struct({ subjectId: Schema.String, body: Schema.String }),
    variables
  );

  const pull = pullById(world, viewer, input.subjectId);
  const id = newId(world, "IC");
  const at = new Date().toISOString();
  const comments = world.issueComments.get(pull.id) ?? [];
  comments.push({ id, author: viewer.login, body: input.body, createdAt: at, updatedAt: at });
  world.issueComments.set(pull.id, comments);

  return {
    addComment: { commentEdge: { node: { id, url: `https://github.test/comment/${id}` } } },
  };
};

export const publishDescription: Resolver = (world, viewer, variables) => {
  const input = inputOf(
    Schema.Struct({ pullRequestId: Schema.String, body: Schema.String }),
    variables
  );

  const pull = pullById(world, viewer, input.pullRequestId);
  pull.body = input.body;

  return {
    updatePullRequest: {
      pullRequest: { id: pull.id, body: pull.body, headRefOid: pull.headRefOid },
    },
  };
};
