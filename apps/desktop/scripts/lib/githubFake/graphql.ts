/**
 * The fake's GraphQL. It doesn't parse GraphQL: it answers the client's named
 * operations (`operationName`) from the world, in the shape GitHub's schema gives.
 */
import { Schema } from "effect";
import { type FakeResponse, type JsonValue, json } from "./http.ts";
import {
  type FakePull,
  type FakeThread,
  type FakeUser,
  type World,
  findRepo,
  pendingReviewOf,
  permissionOf,
  visibleComments,
  visiblePulls,
} from "./world.ts";

export class GraphQLFailure extends Error {
  readonly type: string;

  constructor(type: string, message: string) {
    super(message);
    this.type = type;
  }
}

export const fail = (type: string, message: string): never => {
  throw new GraphQLFailure(type, message);
};

export const errorResponse = (failure: GraphQLFailure): FakeResponse =>
  json(200, { data: null, errors: [{ type: failure.type, message: failure.message }] });

/** The request's JSON body, still as text: each operation decodes its own `variables`. */
export interface Variables {
  readonly body: string;
}

const Envelope = Schema.fromJsonString(
  Schema.Struct({ variables: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)) })
);

const decodeEnvelope = Schema.decodeUnknownSync(Envelope);

const QueryText = Schema.fromJsonString(
  Schema.Struct({ query: Schema.optionalKey(Schema.String) })
);

/** Whether the query names `field`: stacks are answered only when asked, as on GitHub. */
export const asks = (variables: Variables, field: string) =>
  (Schema.decodeUnknownSync(QueryText)(variables.body).query ?? "").includes(field);

/** The head commit's checks, as `commits(last: 1) { … statusCheckRollup }` gives them. */
const checksOf = (pull: FakePull) => ({
  nodes: [
    {
      commit: {
        statusCheckRollup:
          pull.checks === undefined
            ? null
            : { state: pull.checks.state, contexts: { totalCount: pull.checks.total } },
      },
    },
  ],
});

/** `stack` and `stackEntry` for a pull request in one of the world's stacks; null when not asked. */
const stackFields = (world: World, pull: FakePull, asked: boolean) => {
  const stack = world.stacks.find((s) => s.repo === pull.repo && s.pulls.includes(pull.number));

  if (!asked || stack === undefined) return { stack: null, stackEntry: null };

  const member = (number: number) =>
    world.pulls.find((p) => p.repo === pull.repo && p.number === number);

  return {
    stackEntry: { position: stack.pulls.indexOf(pull.number) + 1 },
    stack: {
      number: stack.number,
      size: stack.pulls.length,
      baseRefName: stack.base,
      entries: {
        nodes: stack.pulls.map((number, i) => {
          const p = member(number);

          return {
            position: i + 1,
            pullRequest:
              p === undefined
                ? null
                : {
                    id: p.id,
                    number: p.number,
                    title: p.title,
                    url: `https://github.com/${p.repo}/pull/${p.number}`,
                    headRefName: p.headRefName,
                    state: p.state,
                    isDraft: p.isDraft,
                    additions: p.files.reduce((n, f) => n + f.additions, 0),
                    deletions: p.files.reduce((n, f) => n + f.deletions, 0),
                    commits: checksOf(p),
                  },
          };
        }),
      },
    },
  };
};

type Decodable = Schema.Top & { readonly DecodingServices: never };

export const vars = <S extends Decodable>(schema: S, variables: Variables): S["Type"] =>
  Schema.decodeUnknownSync(schema)(decodeEnvelope(variables.body).variables ?? {});

/** A mutation's `input` variable. */
export const inputOf = <S extends Decodable>(schema: S, variables: Variables): S["Type"] =>
  Schema.decodeUnknownSync(schema)(decodeEnvelope(variables.body).variables?.["input"]);

const PAGE = 100;

export const page = <A>(items: ReadonlyArray<A>, after: string | null) => {
  const start = after === null ? 0 : Number(after);
  const nodes = items.slice(start, start + PAGE);
  const end = start + nodes.length;

  return {
    pageInfo: {
      hasNextPage: end < items.length,
      endCursor: nodes.length === 0 ? null : String(end),
    },
    nodes,
  };
};

const author = (world: World, login: string) => {
  const user = world.users.find((u) => u.login === login);

  return user === undefined ? null : { login: user.login, avatarUrl: user.avatar_url };
};

export const pullById = (world: World, viewer: FakeUser, id: string) => {
  const pull = visiblePulls(world, viewer).find((p) => p.id === id);

  return pull ?? fail("NOT_FOUND", `Could not resolve to a node with the global id of '${id}'`);
};

const viewedState = (world: World, pull: FakePull, viewer: FakeUser, path: string) =>
  world.viewed.get(`${pull.id}:${viewer.login}:${path}`) ?? "UNVIEWED";

const filesOf = (world: World, pull: FakePull, viewer: FakeUser) =>
  pull.files.map((f) => ({ ...f, viewerViewedState: viewedState(world, pull, viewer, f.path) }));

const threadNode = (world: World, thread: FakeThread, viewer: FakeUser) => ({
  id: thread.id,
  path: thread.path,
  isResolved: thread.isResolved,
  isOutdated: thread.subjectType === "LINE" && thread.line === null,
  subjectType: thread.subjectType,
  line: thread.line,
  startLine: thread.line === null ? null : thread.startLine,
  originalLine: thread.originalLine,
  originalStartLine: thread.originalStartLine,
  diffSide: thread.side,
  startDiffSide: thread.startSide,
  comments: {
    nodes: visibleComments(world, thread, viewer).map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      url: `https://github.com/pull#discussion_r${c.id}`,
      state:
        world.reviews.find((r) => r.id === c.reviewId)?.state === "PENDING"
          ? "PENDING"
          : "SUBMITTED",
      diffHunk: thread.diffHunk,
      author: { login: c.author },
      originalCommit: { oid: thread.originalCommit },
    })),
  },
});

const threadsOf = (world: World, pull: FakePull, viewer: FakeUser) =>
  world.threads
    .filter((t) => t.pullId === pull.id)
    .map((t) => threadNode(world, t, viewer))
    .filter((t) => t.comments.nodes.length > 0);

const pendingOf = (world: World, pull: FakePull, viewer: FakeUser) => {
  const review = pendingReviewOf(world, pull.id, viewer);

  const count = world.threads
    .flatMap((t) => t.comments)
    .filter((c) => review !== undefined && c.reviewId === review.id).length;

  return {
    nodes:
      review === undefined
        ? []
        : [{ id: review.id, commit: { oid: review.commitOid }, comments: { totalCount: count } }],
  };
};

const repoOrFail = (world: World, viewer: FakeUser, owner: string, name: string) => {
  const repo = findRepo(world, owner, name);
  const permission = repo === undefined ? null : permissionOf(world, viewer, repo);

  return repo !== undefined && permission !== null
    ? { repo, permission }
    : fail("NOT_FOUND", `Could not resolve to a Repository with the name '${owner}/${name}'.`);
};

const OwnerName = Schema.Struct({ owner: Schema.String, name: Schema.String });

const probeRepo = (world: World, viewer: FakeUser, variables: Variables) => {
  const { owner, name } = vars(OwnerName, variables);
  const { repo, permission } = repoOrFail(world, viewer, owner, name);

  return {
    repository: {
      id: repo.id,
      nameWithOwner: `${repo.owner}/${repo.name}`,
      isArchived: false,
      viewerPermission: permission,
    },
  };
};

const ownerKind = (world: World, _viewer: FakeUser, variables: Variables) => {
  const { login } = vars(Schema.Struct({ login: Schema.String }), variables);
  const isOrg = world.orgs.some((o) => o.login.toLowerCase() === login.toLowerCase());
  const isUser = world.users.some((u) => u.login.toLowerCase() === login.toLowerCase());

  if (isOrg) return { repositoryOwner: { __typename: "Organization" } };

  return { repositoryOwner: isUser ? { __typename: "User" } : null };
};

const matches = (pull: FakePull, viewer: FakeUser, terms: ReadonlyArray<string>) => {
  const repos = terms.flatMap((t) => (t.startsWith("repo:") ? [t.slice(5).toLowerCase()] : []));

  const checks: ReadonlyArray<[string, boolean]> = [
    ["is:open", pull.state === "OPEN"],
    ["review-requested:@me", pull.reviewRequests.includes(viewer.login)],
    ["user-review-requested:@me", pull.reviewRequests.includes(viewer.login)],
    ["author:@me", pull.author === viewer.login],
  ];

  for (const [term, holds] of checks) {
    if (terms.includes(term) && !holds) return false;

    if (terms.includes(`-${term}`) && holds) return false;
  }

  return repos.length === 0 || repos.includes(pull.repo.toLowerCase());
};

const searchNode = (world: World, pull: FakePull, viewer: FakeUser, stacks: boolean) => {
  const latest = world.reviews
    .filter((r) => r.pullId === pull.id && r.author === viewer.login && r.state !== "PENDING")
    .at(-1);

  return {
    id: pull.id,
    number: pull.number,
    title: pull.title,
    url: `https://github.com/${pull.repo}/pull/${pull.number}`,
    isDraft: pull.isDraft,
    state: pull.state,
    updatedAt: pull.updatedAt,
    headRefName: pull.headRefName,
    headRefOid: pull.headRefOid,
    baseRefName: pull.baseRefName,
    additions: pull.files.reduce((n, f) => n + f.additions, 0),
    deletions: pull.files.reduce((n, f) => n + f.deletions, 0),
    isCrossRepository: pull.isCrossRepository ?? false,
    commits: checksOf(pull),
    ...stackFields(world, pull, stacks),
    repository: { nameWithOwner: pull.repo },
    author: author(world, pull.author),
    reviewDecision: pull.reviewDecision,
    reviewRequests: {
      nodes: pull.reviewRequests.map((login) => ({
        requestedReviewer: { __typename: "User", login },
      })),
    },
    viewerLatestReview: latest === undefined ? null : { state: latest.state },
  };
};

const pullSearch = (world: World, viewer: FakeUser, variables: Variables) => {
  const { q } = vars(Schema.Struct({ q: Schema.String }), variables);
  const terms = q.split(/\s+/).filter((t) => t !== "");
  const found = visiblePulls(world, viewer).filter((p) => matches(p, viewer, terms));

  return {
    search: {
      issueCount: found.length,
      nodes: found
        .slice(0, 50)
        .map((p) => searchNode(world, p, viewer, asks(variables, "stackEntry"))),
    },
    rateLimit: {
      cost: 1,
      remaining: 4999,
      resetAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
  };
};

const pullDetail = (world: World, viewer: FakeUser, variables: Variables) => {
  const { owner, name, number } = vars(
    Schema.Struct({ ...OwnerName.fields, number: Schema.Number }),
    variables
  );

  const { repo } = repoOrFail(world, viewer, owner, name);
  const repoName = `${repo.owner}/${repo.name}`;

  const pull = world.pulls.find(
    (p) => p.repo.toLowerCase() === repoName.toLowerCase() && p.number === number
  );

  return {
    viewer: { login: viewer.login },
    repository: {
      nameWithOwner: repoName,
      pullRequest:
        pull === undefined
          ? fail("NOT_FOUND", `Could not resolve to a PullRequest with the number of ${number}.`)
          : {
              id: pull.id,
              number: pull.number,
              title: pull.title,
              body: pull.body,
              url: `https://github.com/${pull.repo}/pull/${pull.number}`,
              state: pull.state,
              isDraft: pull.isDraft,
              author: author(world, pull.author),
              headRefName: pull.headRefName,
              headRefOid: pull.headRefOid,
              baseRefName: pull.baseRefName,
              baseRefOid: pull.baseRefOid,
              commits: { totalCount: world.commits.get(pull.id)?.length ?? 1 },
              checks: checksOf(pull),
              ...stackFields(world, pull, asks(variables, "stackEntry")),
              files: page(filesOf(world, pull, viewer), null),
              reviewThreads: page(threadsOf(world, pull, viewer), null),
              reviews: pendingOf(world, pull, viewer),
            },
    },
  };
};

const IdAfter = Schema.Struct({
  id: Schema.String,
  after: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const pullFiles = (world: World, viewer: FakeUser, variables: Variables) => {
  const { id, after = null } = vars(IdAfter, variables);
  const pull = pullById(world, viewer, id);

  return { node: { files: page(filesOf(world, pull, viewer), after) } };
};

const pullThreads = (world: World, viewer: FakeUser, variables: Variables) => {
  const { id, after = null } = vars(IdAfter, variables);
  const pull = pullById(world, viewer, id);

  return { node: { reviewThreads: page(threadsOf(world, pull, viewer), after) } };
};

const pendingReview = (world: World, viewer: FakeUser, variables: Variables) => {
  const { id } = vars(IdAfter, variables);

  return { node: { reviews: pendingOf(world, pullById(world, viewer, id), viewer) } };
};

const pullStates = (world: World, viewer: FakeUser, variables: Variables) => {
  const { ids } = vars(Schema.Struct({ ids: Schema.Array(Schema.String) }), variables);
  const visible = visiblePulls(world, viewer);

  return {
    nodes: ids.map((id) => {
      const pull = visible.find((p) => p.id === id);

      return pull === undefined
        ? null
        : {
            id: pull.id,
            state: pull.state,
            headRefOid: pull.headRefOid,
            mergedAt: pull.mergedAt,
            closedAt: pull.closedAt,
          };
    }),
  };
};

export type Resolver = (world: World, viewer: FakeUser, variables: Variables) => JsonValue;

export const QUERIES = new Map<string, Resolver>([
  ["ProbeRepo", probeRepo],
  ["OwnerKind", ownerKind],
  ["PullSearch", pullSearch],
  ["PullDetail", pullDetail],
  ["PullFiles", pullFiles],
  ["PullThreads", pullThreads],
  ["PendingReview", pendingReview],
  ["PullStates", pullStates],
]);
