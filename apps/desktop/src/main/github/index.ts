/**
 * `GitHub`: the Desktop App's GitHub client (ENG-185, ENG-219). Accounts through
 * the device flow, tokens sealed in the keychain, repositories routed to accounts,
 * the pull request list, reviews, Viewed marks and Review Checkout states. The
 * renderer reaches it over IPC (`github.*`); see README.md.
 */
import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import {
  type CheckoutStateView,
  type CheckoutWatch,
  type GitHubAccountsView,
  type PullListView,
  parseGitHubRemote,
  type RepoRef,
  repoKey,
  type WorkspaceRef,
  workspaceKey,
} from "../../shared/github.ts";
import { openAccounts } from "./accounts.ts";
import { type BudgetPolicy, DEFAULT_POLICY, newBudget } from "./budget.ts";
import { newCheckouts } from "./checkouts.ts";
import { newClient } from "./client.ts";
import type { EndpointConfig } from "./config.ts";
import { newCreate } from "./create.ts";
import { newCredentials } from "./credentials.ts";
import { DEFAULT_INTERVALS, type Intervals, newPoller } from "./poller.ts";
import { EMPTY_LIST, newPulls, type Watched } from "./pulls.ts";
import { MUTATION_GAP_MS, newReviews } from "./reviews.ts";
import { newRouting } from "./routing.ts";
import { type Crypto, openStore } from "./store.ts";
import { type Fetch, newTransport } from "./transport.ts";

export type { NewPull } from "./create.ts";

export type {
  CommentEdit,
  Discard,
  NewThread,
  Reply,
  Submission,
  ThreadResolution,
  ViewedMark,
} from "./reviews.ts";

export interface GitHubInput {
  /** `<userData>/github`. */
  readonly dir: string;
  readonly crypto: Crypto;
  readonly fetch: Fetch;
  readonly endpoints: EndpointConfig;
  readonly policy?: BudgetPolicy;
  readonly intervals?: Intervals;
  /** The pause between one account's mutations (GitHub asks for a second). */
  readonly mutationGapMs?: number;
  /** Wall-clock ms for rate-limit windows; tests share it with the fake. */
  readonly now?: () => number;
}

/** A Workspace and its git remotes (`origin`, `upstream`…), as the PR list watches them. */
export interface WorkspaceRemotes {
  readonly workspace: WorkspaceRef;
  readonly remotes: ReadonlyArray<string>;
}

/** Groups Workspaces by the repository (on github.com or an Enterprise `hosts`) their remotes point at. */
export const watchedFrom = (
  entries: ReadonlyArray<WorkspaceRemotes>,
  hosts: ReadonlyArray<string> = []
): ReadonlyArray<Watched> => {
  const byRepo = new Map<string, { repo: RepoRef; workspaces: Array<WorkspaceRef> }>();

  for (const { workspace, remotes } of entries) {
    for (const repo of remotes.map((remote) => parseGitHubRemote(remote, hosts))) {
      if (repo === null) continue;

      const entry = byRepo.get(repoKey(repo)) ?? { repo, workspaces: [] };

      if (!entry.workspaces.some((w) => workspaceKey(w) === workspaceKey(workspace))) {
        entry.workspaces.push(workspace);
      }

      byRepo.set(repoKey(repo), entry);
    }
  }

  return [...byRepo.values()];
};

/** Who a pull request watch belongs to. */
type WatchGroup = "checkouts" | "sessions";

const make = Effect.fn("GitHub.make")(function* (input: GitHubInput) {
  const scope = yield* Effect.scope;
  const now = input.now ?? Date.now;
  const store = openStore({ dir: input.dir, crypto: input.crypto });
  const budget = newBudget(now, input.policy ?? DEFAULT_POLICY);
  const transport = newTransport({ fetch: input.fetch, budget, now });
  const accounts = yield* openAccounts({ store, transport, endpoints: input.endpoints, scope });

  const credentials = newCredentials({
    store,
    transport,
    signedOut: accounts.signedOut,
    accessOf: accounts.accessOf,
  });

  const client = newClient(transport, credentials, accounts);
  const routing = newRouting({ client, accounts });
  const reviews = newReviews({ client, routing, gapMs: input.mutationGapMs ?? MUTATION_GAP_MS });
  const list = yield* SubscriptionRef.make<PullListView>(EMPTY_LIST);
  const checkoutStates = yield* SubscriptionRef.make<ReadonlyArray<CheckoutStateView>>([]);

  const poller = yield* newPoller({
    accounts,
    client,
    pulls: newPulls({ client, routing }),
    checkouts: newCheckouts({ client, routing }),
    list,
    checkoutStates,
    intervals: input.intervals ?? DEFAULT_INTERVALS,
  });

  let remotes: ReadonlyArray<WorkspaceRemotes> = [];

  const rewatch = Effect.flatMap(accounts.hostNames, (hosts) =>
    poller.watch(watchedFrom(remotes, hosts))
  );

  // Signing in, out, reordering or adding a host changes which account sees what.
  const signature = (view: GitHubAccountsView) =>
    JSON.stringify([
      (view.hosts ?? []).map((h) => [h.host, h.clientId]),
      view.accounts.map((a) => [a.id, a.state]),
      view.owners,
      view.workspaces,
    ]);

  yield* SubscriptionRef.changes(accounts.view).pipe(
    Stream.map(signature),
    Stream.changes,
    Stream.drop(1),
    Stream.runForEach(() => Effect.andThen(routing.reset, rewatch)),
    Effect.forkIn(scope)
  );
  yield* Effect.forkIn(poller.loop, scope);
  const watchGroups = new Map<WatchGroup, ReadonlyArray<CheckoutWatch>>();

  return {
    accounts: accounts.view,
    pulls: list,
    checkouts: checkoutStates,
    /** Signs in to github.com, or to an Enterprise host added with `addHost`. */
    startSignIn: (host?: string) => accounts.startSignIn(credentials, host),
    addHost: accounts.addHost,
    removeHost: (host: string) => accounts.removeHost(host, credentials),
    cancelSignIn: accounts.cancelSignIn,
    removeAccount: (accountId: number) => accounts.remove(accountId, credentials),
    reorderAccounts: accounts.reorder,
    setOwner: accounts.setOwner,
    setWorkspace: (workspace: WorkspaceRef, accountId: number | null) =>
      accounts.setWorkspace(workspaceKey(workspace), accountId),
    watch: (entries: ReadonlyArray<WorkspaceRemotes>) =>
      Effect.andThen(
        Effect.sync(() => {
          remotes = entries;
        }),
        rewatch
      ),
    /** Each caller (Review Checkouts, accepted sessions' pull requests) keeps its own group. */
    watchCheckouts: (watches: ReadonlyArray<CheckoutWatch>, group: WatchGroup = "checkouts") =>
      Effect.suspend(() => {
        watchGroups.set(group, watches);

        return poller.watchCheckouts([...watchGroups.values()].flat());
      }),
    refresh: poller.poke(true),
    /** The user asked to check a blocked repository again (after requesting access). */
    recheck: (repo: RepoRef) => Effect.andThen(routing.invalidate(repo), poller.poke(true)),
    setFocused: poller.setFocused,
    detail: reviews.detail,
    addThread: reviews.addThread,
    reply: reviews.reply,
    resolveThread: reviews.resolve,
    editComment: reviews.editComment,
    submitReview: reviews.submit,
    discardReview: reviews.discard,
    setViewed: reviews.setViewed,
    createPull: newCreate(client, routing),
  };
});

export class GitHub extends Context.Service<GitHub, Effect.Success<ReturnType<typeof make>>>()(
  "polaris/desktop/GitHub"
) {
  static readonly layer = (input: GitHubInput) => Layer.effect(GitHub, make(input));
}
