/**
 * The pull request list, polled without a server: an ETag'd REST `pulls` request
 * per matched repository (a 304 is free), then GraphQL searches for the four
 * groups only when something changed, or every few minutes for requests elsewhere.
 */
import { Clock, Effect } from "effect";
import {
  type PullListView,
  type PullRowView,
  type RepoRef,
  type ReviewDecision,
  type ViewerReview,
  GITHUB_HOST,
  repoKey,
  type WorkspaceRef,
} from "../../shared/github.ts";
import type { Client } from "./client.ts";
import { PullSearchData, pullSearch, type SearchPull } from "./queries.ts";
import { checksOf, githubStack, withStacks } from "./stacks.ts";
import type { RepoAccess, Routing } from "./routing.ts";
import type { AccountRecord } from "./store.ts";
import { RestPulls } from "./wire.ts";

/** Searches run at least this often even when no watched repository changed. */
export const SEARCH_EVERY_MS = 10 * 60 * 1000;

const OPEN = "is:pr is:open archived:false";

export const QUERIES = {
  requested: `${OPEN} review-requested:@me`,
  mine: `${OPEN} author:@me`,
  other: (repos: ReadonlyArray<string>) =>
    `${OPEN} ${repos.map((r) => `repo:${r}`).join(" ")} -author:@me -review-requested:@me`,
  /** Open pull requests the viewer reviewed, in any repository (Review's Reviewed group). */
  reviewed: `${OPEN} reviewed-by:@me -author:@me -review-requested:@me`,
};

/** GraphQL searches one account's poll sends. */
export const SEARCHES = Object.keys(QUERIES).length;

/** A watched repository and the Workspaces whose remotes point at it. */
export interface Watched {
  readonly repo: RepoRef;
  readonly workspaces: ReadonlyArray<WorkspaceRef>;
}

const DECISIONS = new Map<string, ReviewDecision>([
  ["APPROVED", "approved"],
  ["CHANGES_REQUESTED", "changes-requested"],
  ["REVIEW_REQUIRED", "review-required"],
]);

/** The viewer's latest submitted review, from `viewerReviews` (`author: $login`). */
const viewerReviewOf = (pull: SearchPull): ViewerReview | null => {
  const last = pull.viewerReviews?.nodes.at(-1);

  return last?.submittedAt == null
    ? null
    : { at: last.submittedAt, commitOid: last.commit?.oid ?? null };
};

/**
 * Whether GitHub asks the viewer by name for a review now, read live (the search index lags
 * a review). A team's request doesn't count: a member's review may leave it standing.
 */
const viewerRequestedOf = (pull: SearchPull, login: string | null) =>
  login !== null &&
  pull.reviewRequests.nodes.some(
    (n) => n.requestedReviewer?.login?.toLowerCase() === login.toLowerCase()
  );

export const rowOf = (
  pull: SearchPull,
  accountId: number,
  workspaces: ReadonlyArray<WorkspaceRef>,
  host: string = GITHUB_HOST,
  /** The account's login when the pull request came from its review-requested search. */
  requestedOf: string | null = null
): PullRowView => ({
  id: pull.id,
  number: pull.number,
  title: pull.title,
  url: pull.url,
  repo: pull.repository.nameWithOwner,
  host,
  isDraft: pull.isDraft,
  author: pull.author,
  headRefName: pull.headRefName,
  headRefOid: pull.headRefOid,
  baseRefName: pull.baseRefName,
  additions: pull.additions,
  deletions: pull.deletions,
  updatedAt: pull.updatedAt,
  reviewDecision: DECISIONS.get(pull.reviewDecision ?? "") ?? null,
  viewerLatestReview: pull.viewerLatestReview?.state ?? null,
  viewerReview: viewerReviewOf(pull),
  viewerRequested: viewerRequestedOf(pull, requestedOf),
  requestedReviewers: pull.reviewRequests.nodes.flatMap((n) => {
    const name = n.requestedReviewer?.login ?? n.requestedReviewer?.slug;

    return name === undefined ? [] : [name];
  }),
  accountId,
  workspaces,
  fromFork: pull.isCrossRepository ?? false,
  checks: checksOf(pull.commits),
  stack: githubStack(pull.stack, pull.stackEntry),
});

/** Newest first, each pull request once (the first group that has it keeps it). */
const merge = (rows: ReadonlyArray<PullRowView>, taken: ReadonlySet<string>) => {
  const seen = new Set(taken);

  return rows
    .filter((r) => !seen.has(r.id) && seen.add(r.id) !== undefined)
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export interface Found {
  readonly accountId: number;
  readonly host: string;
  /** Absent in older callers; the requested rows then never say the viewer is asked. */
  readonly login?: string;
  readonly requested: ReadonlyArray<SearchPull>;
  readonly mine: ReadonlyArray<SearchPull>;
  readonly other: ReadonlyArray<SearchPull>;
  readonly reviewed?: ReadonlyArray<SearchPull>;
}

/** The three groups across every account; Workspaces attached by repository. */
export const groups = (found: ReadonlyArray<Found>, watched: ReadonlyArray<Watched>) => {
  const byRepo = new Map(watched.map((w) => [repoKey(w.repo), w.workspaces]));

  const rows = (pick: (f: Found) => ReadonlyArray<SearchPull>, asked = false) =>
    found.flatMap((f) =>
      pick(f).map((p) => {
        const [owner = "", name = ""] = p.repository.nameWithOwner.split("/");

        return rowOf(
          p,
          f.accountId,
          byRepo.get(repoKey({ host: f.host, owner, name })) ?? [],
          f.host,
          asked ? (f.login ?? null) : null
        );
      })
    );

  const requested = merge(
    rows((f) => f.requested, true),
    new Set()
  );

  const mine = merge(
    rows((f) => f.mine),
    new Set(requested.map((r) => r.id))
  );

  const other = merge(
    rows((f) => f.other),
    new Set([...requested, ...mine].map((r) => r.id))
  );

  const reviewed = merge(
    rows((f) => f.reviewed ?? []),
    new Set([...requested, ...mine, ...other].map((r) => r.id))
  );

  // A stack's layers can sit in different groups: infer across all of them at once.
  const stacked = withStacks([...requested, ...mine, ...other, ...reviewed]);
  const byId = new Map(stacked.map((r) => [r.id, r]));
  const back = (list: ReadonlyArray<PullRowView>) => list.map((r) => byId.get(r.id) ?? r);

  return {
    requested: back(requested),
    mine: back(mine),
    other: back(other),
    reviewed: back(reviewed),
  };
};

export interface PullsInput {
  readonly client: Client;
  readonly routing: Routing;
}

export const newPulls = ({ client, routing }: PullsInput) => {
  const etags = new Map<string, string>();
  const lastSearch = new Map<number, number>();
  let found: ReadonlyArray<Found> = [];

  /** Whether the repository's open pulls changed since the last poll; a 304 costs nothing. */
  const changed = (access: RepoAccess) =>
    Effect.gen(function* () {
      const accountId = access.accountId;

      if (accountId === null || !client.budget.allows(accountId, "core", 1)) return false;

      const key = repoKey(access.repo);

      const result = yield* client
        .rest(accountId, RestPulls, {
          method: "GET",
          path: `/repos/${access.repo.owner}/${access.repo.name}/pulls?state=open&per_page=100`,
          etag: etags.get(key) ?? null,
          body: null,
        })
        .pipe(
          Effect.tapErrorTag("GitHubNotFound", () => routing.invalidate(access.repo)),
          Effect.orElseSucceed(() => ({ status: "not-modified" }) as const)
        );

      if (result.status === "not-modified") return false;

      if (result.etag !== null) etags.set(key, result.etag);

      return true;
    });

  const search = (account: AccountRecord, q: string) =>
    client
      .graphql(
        account.id,
        PullSearchData,
        pullSearch({ q, login: account.login }, account.host === GITHUB_HOST)
      )
      .pipe(Effect.map(({ search: s }) => s.nodes));

  const searchAccount = (account: AccountRecord, repos: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const [requested, mine, other, reviewed] = yield* Effect.all([
        search(account, QUERIES.requested),
        search(account, QUERIES.mine),
        repos.length === 0 ? Effect.succeed([]) : search(account, QUERIES.other(repos)),
        search(account, QUERIES.reviewed),
      ]);

      lastSearch.set(account.id, yield* Clock.currentTimeMillis);

      return {
        accountId: account.id,
        host: account.host,
        login: account.login,
        requested,
        mine,
        other,
        reviewed,
      } satisfies Found;
    });

  const due = (account: AccountRecord, dirty: ReadonlySet<number>, now: number) =>
    dirty.has(account.id) || now - (lastSearch.get(account.id) ?? 0) >= SEARCH_EVERY_MS;

  /** One poll. `force`: search every account now (the user asked, or a Workspace was added). */
  const poll = (
    watched: ReadonlyArray<Watched>,
    accounts: ReadonlyArray<AccountRecord>,
    force: boolean
  ) =>
    Effect.gen(function* () {
      const access = yield* Effect.forEach(watched, (w) =>
        routing.resolve(w.repo, w.workspaces[0] ?? null)
      );

      const dirty = new Set<number>();
      let throttled = false;

      for (const a of access.filter((x) => x.state === "ok")) {
        if (yield* changed(a)) dirty.add(a.accountId ?? 0);
      }

      const now = yield* Clock.currentTimeMillis;
      const next: Array<Found> = [];

      for (const account of accounts) {
        const previous = found.find((f) => f.accountId === account.id);

        if (!force && !due(account, dirty, now) && previous !== undefined) {
          next.push(previous);
          continue;
        }

        if (!client.budget.allows(account.id, "graphql", SEARCHES)) {
          throttled = true;

          if (previous !== undefined) next.push(previous);
          continue;
        }

        const repos = access
          .filter((a) => a.state === "ok" && a.accountId === account.id)
          .map((a) => `${a.repo.owner}/${a.repo.name}`);

        next.push(yield* searchAccount(account, repos));
      }

      found = next;

      return { access, throttled, ...groups(found, watched) };
    });

  return { poll };
};

export type Pulls = ReturnType<typeof newPulls>;

export type PollResult = Effect.Success<ReturnType<Pulls["poll"]>>;

export const EMPTY_LIST: PullListView = {
  requested: [],
  mine: [],
  other: [],
  reviewed: [],
  repos: [],
  updatedAt: null,
  polling: "idle",
  throttledUntil: null,
  error: null,
  errorKind: null,
};
