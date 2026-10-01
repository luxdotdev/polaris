/**
 * The fake's state: users, orgs (some with OAuth App restrictions), repositories
 * with per-user permissions, pull requests, reviews, threads and Viewed marks.
 * Starts from `fixtures/world.json`; mutations change it in memory.
 */
import { readFileSync } from "node:fs";
import { Schema } from "effect";

const FixtureComment = Schema.Struct({
  id: Schema.String,
  author: Schema.String,
  body: Schema.String,
  createdAt: Schema.String,
});

const FixtureThread = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  line: Schema.NullOr(Schema.Number),
  startLine: Schema.NullOr(Schema.Number),
  originalLine: Schema.optionalKey(Schema.Number),
  side: Schema.Literals(["LEFT", "RIGHT"]),
  subjectType: Schema.Literals(["LINE", "FILE"]),
  isResolved: Schema.Boolean,
  originalCommit: Schema.String,
  diffHunk: Schema.String,
  comments: Schema.Array(FixtureComment),
});

const FixturePull = Schema.Struct({
  id: Schema.String,
  repo: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  body: Schema.String,
  author: Schema.String,
  state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
  isDraft: Schema.Boolean,
  headRefName: Schema.String,
  headRefOid: Schema.String,
  baseRefName: Schema.String,
  baseRefOid: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  reviewRequests: Schema.Array(Schema.String),
  reviewDecision: Schema.NullOr(Schema.String),
  files: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      additions: Schema.Number,
      deletions: Schema.Number,
      changeType: Schema.String,
    })
  ),
  threads: Schema.Array(FixtureThread),
  /** Its head lives in a fork. */
  isCrossRepository: Schema.optionalKey(Schema.Boolean),
  /** The head commit's checks rollup: SUCCESS, FAILURE, ERROR, PENDING. */
  checks: Schema.optionalKey(Schema.Struct({ state: Schema.String, total: Schema.Number })),
});

/** A GitHub stack: its pull requests by number, bottom (closest to `base`) first. */
const FixtureStack = Schema.Struct({
  repo: Schema.String,
  number: Schema.Number,
  base: Schema.String,
  pulls: Schema.Array(Schema.Number),
});

export const Fixture = Schema.Struct({
  users: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      login: Schema.String,
      name: Schema.NullOr(Schema.String),
      avatar_url: Schema.String,
    })
  ),
  orgs: Schema.Array(Schema.Struct({ login: Schema.String, restricted: Schema.Boolean })),
  repos: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      owner: Schema.String,
      name: Schema.String,
      access: Schema.Record(Schema.String, Schema.String),
    })
  ),
  pulls: Schema.Array(FixturePull),
  stacks: Schema.optionalKey(Schema.Array(FixtureStack)),
});

export type FakeStack = typeof FixtureStack.Type;

export type Fixture = typeof Fixture.Type;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export type FakeUser = Fixture["users"][number];

export type FakeRepo = Fixture["repos"][number];

export interface FakeComment {
  readonly id: string;
  /** Null for a comment from the fixture (already submitted). */
  readonly reviewId: string | null;
  readonly author: string;
  body: string;
  readonly createdAt: string;
}

export interface FakeThread {
  readonly id: string;
  readonly pullId: string;
  readonly path: string;
  line: number | null;
  readonly startLine: number | null;
  readonly originalLine: number | null;
  readonly originalStartLine: number | null;
  readonly side: "LEFT" | "RIGHT";
  readonly startSide: "LEFT" | "RIGHT" | null;
  readonly subjectType: "LINE" | "FILE";
  isResolved: boolean;
  readonly originalCommit: string;
  readonly diffHunk: string;
  readonly comments: Array<FakeComment>;
}

export type ReviewState = "PENDING" | "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED";

export interface FakeReview {
  readonly id: string;
  readonly pullId: string;
  readonly author: string;
  state: ReviewState;
  readonly commitOid: string;
  body: string;
  submittedAt: string | null;
}

export type FakePull = Mutable<Omit<Fixture["pulls"][number], "threads" | "reviewRequests">> & {
  reviewRequests: Array<string>;
  mergedAt: string | null;
  closedAt: string | null;
};

/** A commit on a pull request's branch, oldest first in `World.commits`. */
export interface FakeCommit {
  readonly oid: string;
  readonly message: string;
  readonly date: string;
}

export interface World {
  readonly users: ReadonlyArray<FakeUser>;
  readonly orgs: Array<Mutable<Fixture["orgs"][number]>>;
  readonly repos: Array<FakeRepo>;
  readonly pulls: Array<FakePull>;
  readonly reviews: Array<FakeReview>;
  readonly threads: Array<FakeThread>;
  /** `pullId:login:path` → VIEWED or DISMISSED; absent is UNVIEWED. */
  readonly viewed: Map<string, "VIEWED" | "DISMISSED">;
  /** Pull request id → its commits, oldest first; the last is `headRefOid`. */
  readonly commits: Map<string, Array<FakeCommit>>;
  /** GitHub's stacks (`seedStacks`); empty in the base world. */
  readonly stacks: Array<FakeStack>;
  nextId: number;
}

const decodeFixture = Schema.decodeUnknownSync(Schema.fromJsonString(Fixture));

/** `world` is github.com's; `ghe` a GitHub Enterprise host's (its mona has the same user id). */
export const loadFixture = (name: "world" | "ghe" | "stacks" = "world"): Fixture =>
  decodeFixture(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

export const worldFrom = (fixture: Fixture): World => ({
  users: fixture.users,
  orgs: fixture.orgs.map((o) => ({ ...o })),
  repos: [...fixture.repos],
  pulls: fixture.pulls.map(({ threads: _threads, reviewRequests, ...pull }) => ({
    ...pull,
    reviewRequests: [...reviewRequests],
    mergedAt: null,
    closedAt: null,
  })),
  reviews: [],
  commits: new Map(
    fixture.pulls.map((p) => [p.id, [{ oid: p.headRefOid, message: p.title, date: p.updatedAt }]])
  ),
  threads: fixture.pulls.flatMap((pull) =>
    pull.threads.map((t) => ({
      id: t.id,
      pullId: pull.id,
      path: t.path,
      line: t.line,
      startLine: t.startLine,
      originalLine: t.originalLine ?? t.line,
      originalStartLine: t.startLine,
      side: t.side,
      startSide: t.startLine === null ? null : t.side,
      subjectType: t.subjectType,
      isResolved: t.isResolved,
      originalCommit: t.originalCommit,
      diffHunk: t.diffHunk,
      comments: t.comments.map((c) => ({ ...c, reviewId: null })),
    }))
  ),
  viewed: new Map(),
  stacks: [...(fixture.stacks ?? [])],
  nextId: 1,
});

/**
 * Adds `fixtures/stacks.json` to a world: acme/platform's GitHub stack #635 of four layers
 * (#62 asks mona's review) and acme/infra's chain of two with no GitHub stack (inferred).
 */
export const seedStacks = (world: World) => {
  const extra = worldFrom(loadFixture("stacks"));

  world.repos.push(...extra.repos);
  world.pulls.push(...extra.pulls);
  world.stacks.push(...extra.stacks);

  for (const [id, commits] of extra.commits) world.commits.set(id, commits);
};

export const newId = (world: World, prefix: string) => `${prefix}_fake${world.nextId++}`;

export const repoName = (repo: FakeRepo) => `${repo.owner}/${repo.name}`;

export const findRepo = (world: World, owner: string, name: string) =>
  world.repos.find(
    (r) =>
      r.owner.toLowerCase() === owner.toLowerCase() && r.name.toLowerCase() === name.toLowerCase()
  );

/** What a user's token can see: their permission, unless the org restricts OAuth Apps. */
export const permissionOf = (world: World, user: FakeUser, repo: FakeRepo) => {
  const restricted = world.orgs.some((o) => o.login === repo.owner && o.restricted);

  return restricted ? null : (repo.access[String(user.id)] ?? null);
};

export const visiblePulls = (world: World, user: FakeUser) =>
  world.pulls.filter((pull) => {
    const [owner = "", name = ""] = pull.repo.split("/");
    const repo = findRepo(world, owner, name);

    return repo !== undefined && permissionOf(world, user, repo) !== null;
  });

/** A thread's comments as `viewer` sees them: others' pending comments are hidden. */
export const visibleComments = (world: World, thread: FakeThread, viewer: FakeUser) =>
  thread.comments.filter((c) => {
    const review = world.reviews.find((r) => r.id === c.reviewId);

    return review === undefined || review.state !== "PENDING" || review.author === viewer.login;
  });

export const pendingReviewOf = (world: World, pullId: string, viewer: FakeUser) =>
  world.reviews.find(
    (r) => r.pullId === pullId && r.author === viewer.login && r.state === "PENDING"
  );
