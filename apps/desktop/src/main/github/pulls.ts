/**
 * The pull request list, polled without a server: an ETag'd REST `pulls` request
 * per matched repository (a 304 is free), then GraphQL searches for the three
 * groups only when something changed, or every few minutes for requests elsewhere.
 */
import { Clock, Effect } from "effect";
import {
  type PullListView,
  type PullRowView,
  type RepoRef,
  type ReviewDecision,
  repoKey,
  type WorkspaceRef,
} from "../../shared/github.ts";
import type { Client } from "./client.ts";
import { PullSearchData, pullSearch, type SearchPull } from "./queries.ts";
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
};

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

export const rowOf = (
  pull: SearchPull,
  accountId: number,
  workspaces: ReadonlyArray<WorkspaceRef>
): PullRowView => ({
  id: pull.id,
  number: pull.number,
  title: pull.title,
  url: pull.url,
  repo: pull.repository.nameWithOwner,
  isDraft: pull.isDraft,
  author: pull.author,
  headRefName: pull.headRefName,
  headRefOid: pull.headRefOid,
  baseRefName: pull.baseRefName,
  updatedAt: pull.updatedAt,
  reviewDecision: DECISIONS.get(pull.reviewDecision ?? "") ?? null,
  viewerLatestReview: pull.viewerLatestReview?.state ?? null,
  requestedReviewers: pull.reviewRequests.nodes.flatMap((n) => {
    const name = n.requestedReviewer?.login ?? n.requestedReviewer?.slug;

    return name === undefined ? [] : [name];
  }),
  accountId,
  workspaces,
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
  readonly requested: ReadonlyArray<SearchPull>;
  readonly mine: ReadonlyArray<SearchPull>;
  readonly other: ReadonlyArray<SearchPull>;
}

/** The three groups across every account; Workspaces attached by repository. */
export const groups = (found: ReadonlyArray<Found>, watched: ReadonlyArray<Watched>) => {
  const byRepo = new Map(watched.map((w) => [repoKey(w.repo), w.workspaces]));

  const rows = (pick: (f: Found) => ReadonlyArray<SearchPull>) =>
    found.flatMap((f) =>
      pick(f).map((p) => {
        const [owner = "", name = ""] = p.repository.nameWithOwner.split("/");

        return rowOf(p, f.accountId, byRepo.get(repoKey({ owner, name })) ?? []);
      })
    );

  const requested = merge(
    rows((f) => f.requested),
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

  return { requested, mine, other };
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

  const search = (accountId: number, q: string) =>
    client
      .graphql(accountId, PullSearchData, pullSearch({ q }))
      .pipe(Effect.map(({ search: s }) => s.nodes));

  const searchAccount = (account: AccountRecord, repos: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const [requested, mine, other] = yield* Effect.all([
        search(account.id, QUERIES.requested),
        search(account.id, QUERIES.mine),
        repos.length === 0 ? Effect.succeed([]) : search(account.id, QUERIES.other(repos)),
      ]);

      lastSearch.set(account.id, yield* Clock.currentTimeMillis);

      return { accountId: account.id, requested, mine, other } satisfies Found;
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

        if (!client.budget.allows(account.id, "graphql", 3)) {
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
  repos: [],
  updatedAt: null,
  polling: "idle",
  throttledUntil: null,
  error: null,
};
