/**
 * Which account reaches a repository: the Workspace's override, then the owner's
 * mapping, then each account in order until one has a `viewerPermission`. An
 * org repo no account sees is `blocked` (OAuth App restrictions or SSO).
 */
import { Clock, Effect } from "effect";
import {
  type RepoAccessState,
  type RepoRef,
  repoKey,
  type WorkspaceRef,
  workspaceKey,
} from "../../shared/github.ts";
import type { Accounts } from "./accounts.ts";
import type { Client } from "./client.ts";
import { type GitHubEndpoints, manageUrl, ssoUrl } from "./config.ts";
import { OwnerKindData, ownerKind, ProbeRepoData, probeRepo } from "./queries.ts";
import type { AccountRecord } from "./store.ts";

/** A repository nobody could see is checked again after this long, never on every poll. */
export const RECHECK_MS = 30 * 60 * 1000;

export interface RepoAccess {
  readonly repo: RepoRef;
  readonly state: RepoAccessState;
  readonly accountId: number | null;
  readonly login: string | null;
  readonly permission: string | null;
  readonly approvalUrl: string | null;
  readonly ssoUrl: string | null;
  readonly checkedAt: number;
}

export interface RoutingInput {
  readonly client: Client;
  readonly accounts: Accounts;
  readonly endpoints: GitHubEndpoints;
}

type Probe =
  | { readonly kind: "ok"; readonly permission: string; readonly nameWithOwner: string }
  | { readonly kind: "unseen" }
  | { readonly kind: "unknown" };

/** The user's preference first, then the rest in their order; each account once. */
export const candidates = (
  accounts: ReadonlyArray<AccountRecord>,
  preferred: ReadonlyArray<number | undefined>
) => {
  const ids = [...preferred.filter((id) => id !== undefined), ...accounts.map((a) => a.id)];

  return [...new Set(ids)].flatMap((id) => accounts.filter((a) => a.id === id));
};

export const newRouting = ({ client, accounts, endpoints }: RoutingInput) => {
  const cache = new Map<string, RepoAccess>();

  const probe = (accountId: number, repo: RepoRef) =>
    client
      .graphql(accountId, ProbeRepoData, probeRepo({ owner: repo.owner, name: repo.name }))
      .pipe(
        Effect.map(({ repository }): Probe =>
          repository?.viewerPermission === null || repository === null
            ? { kind: "unseen" }
            : {
                kind: "ok",
                permission: repository.viewerPermission,
                nameWithOwner: repository.nameWithOwner,
              }
        ),
        Effect.catchTags({
          GitHubNotFound: () => Effect.succeed<Probe>({ kind: "unseen" }),
          GitHubForbidden: () => Effect.succeed<Probe>({ kind: "unseen" }),
          GitHubAuthError: () => Effect.succeed<Probe>({ kind: "unseen" }),
          GitHubRateLimited: () => Effect.succeed<Probe>({ kind: "unknown" }),
          GitHubRequestError: () => Effect.succeed<Probe>({ kind: "unknown" }),
          GitHubStorageError: () => Effect.succeed<Probe>({ kind: "unknown" }),
        })
      );

  const isOrg = (accountId: number, owner: string) =>
    client.graphql(accountId, OwnerKindData, ownerKind({ login: owner })).pipe(
      Effect.map(({ repositoryOwner }) => repositoryOwner?.__typename === "Organization"),
      Effect.orElseSucceed(() => false)
    );

  const access = (repo: RepoRef, fields: Partial<RepoAccess>, now: number): RepoAccess => ({
    repo,
    state: "checking",
    accountId: null,
    login: null,
    permission: null,
    approvalUrl: null,
    ssoUrl: null,
    checkedAt: now,
    ...fields,
  });

  const nobody = (repo: RepoRef, first: AccountRecord, now: number) =>
    Effect.map(isOrg(first.id, repo.owner), (org) =>
      org
        ? access(
            repo,
            {
              state: "blocked",
              login: first.login,
              approvalUrl: manageUrl(endpoints),
              ssoUrl: ssoUrl(endpoints, repo.owner),
            },
            now
          )
        : access(repo, { state: "not-found", login: first.login }, now)
    );

  const route = (repo: RepoRef, workspace: WorkspaceRef | null) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const file = yield* accounts.file;
      const active = yield* accounts.active;
      const previous = cache.get(repoKey(repo));

      const order = candidates(active, [
        workspace === null ? undefined : file.workspaces[workspaceKey(workspace)],
        file.owners[repo.owner.toLowerCase()],
        previous?.accountId ?? undefined,
      ]);

      const first = order[0];

      if (first === undefined) return access(repo, { state: "no-account" }, now);

      for (const account of order) {
        const seen = yield* probe(account.id, repo);

        if (seen.kind === "unknown") return access(repo, { state: "checking" }, now);

        if (seen.kind === "ok") {
          return access(
            repo,
            {
              state: "ok",
              accountId: account.id,
              login: account.login,
              permission: seen.permission,
            },
            now
          );
        }
      }

      return yield* nobody(repo, first, now);
    });

  const fresh = (cached: RepoAccess, now: number) =>
    cached.state === "ok" || (cached.state !== "checking" && now - cached.checkedAt < RECHECK_MS);

  /** The cached route, probing again when it is missing, transient, or old and unseen. */
  const resolve = (repo: RepoRef, workspace: WorkspaceRef | null) =>
    Effect.gen(function* () {
      const cached = cache.get(repoKey(repo));

      if (cached !== undefined && fresh(cached, yield* Clock.currentTimeMillis)) return cached;

      const routed = yield* route(repo, workspace);

      cache.set(repoKey(repo), routed);

      return routed;
    });

  return {
    resolve,
    /** A call through the cached account said not found: route it again next time. */
    invalidate: (repo: RepoRef) => Effect.sync(() => cache.delete(repoKey(repo))),
    /** Preferences or accounts changed: every repository is routed again. */
    reset: Effect.sync(() => cache.clear()),
    cached: (repo: RepoRef) => cache.get(repoKey(repo)),
  };
};

export type Routing = ReturnType<typeof newRouting>;
