/**
 * The background loop: polls the pull request list and the Review Checkouts'
 * states every minute while a window is focused, every five otherwise, and at
 * once when asked (a refresh, new Workspaces, an account change).
 */
import { Clock, Effect, Queue, SubscriptionRef } from "effect";
import {
  type CheckoutStateView,
  type CheckoutWatch,
  hostOf,
  type PullListView,
  type RepoAccessView,
  repoKey,
} from "../../shared/github.ts";
import type { Accounts } from "./accounts.ts";
import type { Checkouts } from "./checkouts.ts";
import type { Client } from "./client.ts";
import type { PollResult, Pulls, Watched } from "./pulls.ts";
import type { RepoAccess } from "./routing.ts";

export interface Intervals {
  readonly focusedMs: number;
  readonly backgroundMs: number;
}

export const DEFAULT_INTERVALS: Intervals = { focusedMs: 60_000, backgroundMs: 300_000 };

export interface PollerInput {
  readonly accounts: Accounts;
  readonly client: Client;
  readonly pulls: Pulls;
  readonly checkouts: Checkouts;
  readonly list: SubscriptionRef.SubscriptionRef<PullListView>;
  readonly checkoutStates: SubscriptionRef.SubscriptionRef<ReadonlyArray<CheckoutStateView>>;
  readonly intervals: Intervals;
}

export const accessView = (
  access: RepoAccess,
  watched: ReadonlyArray<Watched>
): RepoAccessView => ({
  repo: `${access.repo.owner}/${access.repo.name}`,
  host: hostOf(access.repo),
  state: access.state,
  accountId: access.accountId,
  login: access.login,
  permission: access.permission,
  approvalUrl: access.approvalUrl,
  ssoUrl: access.ssoUrl,
  workspaces: watched.find((w) => repoKey(w.repo) === repoKey(access.repo))?.workspaces ?? [],
});

export const newPoller = Effect.fn("newPoller")(function* (input: PollerInput) {
  const { accounts, client, pulls, checkouts, list, checkoutStates, intervals } = input;
  const wake = yield* Queue.sliding<boolean>(1);
  let watched: ReadonlyArray<Watched> = [];
  let watches: ReadonlyArray<CheckoutWatch> = [];
  let focused = true;
  let throttledUntil: number | null = null;

  const blockedUntil = (ids: ReadonlyArray<number>) => {
    const resets = ids.flatMap((id) =>
      [client.budget.blockedUntil(id, "core"), client.budget.blockedUntil(id, "graphql")].filter(
        (at) => at !== null
      )
    );

    return resets.length === 0 ? null : Math.min(...resets);
  };

  const listed = (result: PollResult, now: number, ids: ReadonlyArray<number>): PullListView => {
    throttledUntil = result.throttled ? blockedUntil(ids) : null;

    return {
      requested: result.requested,
      mine: result.mine,
      other: result.other,
      repos: result.access.map((a) => accessView(a, watched)),
      updatedAt: now,
      polling: throttledUntil !== null ? "throttled" : focused ? "focused" : "background",
      throttledUntil,
      error: null,
    };
  };

  const pollList = (force: boolean) =>
    Effect.gen(function* () {
      const active = yield* accounts.active;
      const now = yield* Clock.currentTimeMillis;

      if (!force && throttledUntil !== null && throttledUntil > now) return;

      if (active.length === 0) {
        const repos = watched.map((w) =>
          accessView(
            {
              repo: w.repo,
              state: "no-account",
              accountId: null,
              login: null,
              permission: null,
              approvalUrl: null,
              ssoUrl: null,
              checkedAt: now,
            },
            watched
          )
        );

        return yield* SubscriptionRef.update(list, (v): PullListView => ({
          ...v,
          requested: [],
          mine: [],
          other: [],
          repos,
          polling: "idle",
        }));
      }

      const ids = active.map((a) => a.id);

      const view = yield* pulls.poll(watched, active, force).pipe(
        Effect.map((result) => listed(result, now, ids)),
        Effect.catchTag("GitHubRateLimited", (limited) =>
          Effect.map(SubscriptionRef.get(list), (v): PullListView => {
            throttledUntil = limited.resetAt;

            return { ...v, polling: "throttled", throttledUntil: limited.resetAt };
          })
        ),
        Effect.catch((error) =>
          Effect.map(SubscriptionRef.get(list), (v): PullListView => ({
            ...v,
            error: error.message,
          }))
        )
      );

      yield* SubscriptionRef.set(list, view);
    });

  const pollCheckouts = Effect.gen(function* () {
    if (watches.length === 0) return yield* SubscriptionRef.set(checkoutStates, []);

    const states = yield* checkouts.states(watches);

    yield* SubscriptionRef.set(checkoutStates, states);
  });

  const cycle = (force: boolean) =>
    Effect.andThen(pollList(force), pollCheckouts).pipe(
      Effect.catchCause((cause) => Effect.logWarning("github: poll failed", cause))
    );

  const loop = Effect.gen(function* () {
    let force = true;

    for (;;) {
      yield* cycle(force);

      const wait = focused ? intervals.focusedMs : intervals.backgroundMs;

      force = yield* Effect.raceFirst(Queue.take(wake), Effect.as(Effect.sleep(wait), false));
    }
  });

  const poke = (force: boolean) => Queue.offer(wake, force).pipe(Effect.asVoid);

  return {
    loop,
    poke,
    watch: (next: ReadonlyArray<Watched>) =>
      Effect.andThen(
        Effect.sync(() => {
          watched = next;
        }),
        poke(true)
      ),
    watchCheckouts: (next: ReadonlyArray<CheckoutWatch>) =>
      Effect.andThen(
        Effect.sync(() => {
          watches = next;
        }),
        poke(false)
      ),
    setFocused: (next: boolean) =>
      Effect.suspend(() => {
        const gained = next && !focused;

        focused = next;

        return gained ? poke(false) : Effect.void;
      }),
  };
});

export type Poller = Effect.Success<ReturnType<typeof newPoller>>;
