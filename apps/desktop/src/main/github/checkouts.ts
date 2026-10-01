/**
 * Merge, close and new commits for every Review Checkout's pull request: one
 * `nodes` query per account for up to 100 of them (about a point). Never from
 * local git: squash and rebase merges leave no trace there.
 */
import { Effect } from "effect";
import {
  type CheckoutStateView,
  type CheckoutWatch,
  type PullState,
  repoKey,
} from "../../shared/github.ts";
import type { Client } from "./client.ts";
import { PullStatesData, pullStates } from "./queries.ts";
import type { Routing } from "./routing.ts";

const CHUNK = 100;

const STATES = new Map<string, PullState>([
  ["OPEN", "open"],
  ["CLOSED", "closed"],
  ["MERGED", "merged"],
]);

const unknown = (watch: CheckoutWatch): CheckoutStateView => ({
  key: watch.key,
  pullId: watch.pullId,
  state: "unknown",
  headRefOid: null,
  closedAt: null,
});

export interface CheckoutsInput {
  readonly client: Client;
  readonly routing: Routing;
}

export const newCheckouts = ({ client, routing }: CheckoutsInput) => {
  const byAccount = (watches: ReadonlyArray<CheckoutWatch>) =>
    Effect.gen(function* () {
      const groups = new Map<number, Array<CheckoutWatch>>();
      const unrouted: Array<CheckoutWatch> = [];

      for (const watch of watches) {
        const access = yield* routing.resolve(watch.pull.repo, null);

        if (access.accountId === null) unrouted.push(watch);
        else groups.set(access.accountId, [...(groups.get(access.accountId) ?? []), watch]);
      }

      return { groups, unrouted };
    });

  const chunk = (accountId: number, watches: ReadonlyArray<CheckoutWatch>) =>
    client
      .graphql(accountId, PullStatesData, pullStates({ ids: watches.map((w) => w.pullId) }))
      .pipe(
        Effect.map(({ nodes }) =>
          watches.map((watch): CheckoutStateView => {
            const node = nodes.find((n) => n?.id === watch.pullId) ?? null;

            return node === null
              ? unknown(watch)
              : {
                  key: watch.key,
                  pullId: node.id,
                  state: STATES.get(node.state) ?? "unknown",
                  headRefOid: node.headRefOid,
                  closedAt: node.mergedAt ?? node.closedAt,
                };
          })
        ),
        Effect.orElseSucceed(() => watches.map(unknown))
      );

  /** Each watched checkout's pull request state; `unknown` when it can't be read now. */
  const states = (watches: ReadonlyArray<CheckoutWatch>) =>
    Effect.gen(function* () {
      const { groups, unrouted } = yield* byAccount(watches);
      const results: Array<CheckoutStateView> = unrouted.map(unknown);

      for (const [accountId, group] of groups) {
        for (let i = 0; i < group.length; i += CHUNK) {
          results.push(...(yield* chunk(accountId, group.slice(i, i + CHUNK))));
        }
      }

      return watches.flatMap((w) => results.filter((r) => r.key === w.key));
    });

  return { states };
};

export type Checkouts = ReturnType<typeof newCheckouts>;

/** The repositories the watches touch, for routing ahead of the first poll. */
export const watchedRepos = (watches: ReadonlyArray<CheckoutWatch>) => [
  ...new Map(watches.map((w) => [repoKey(w.pull.repo), w.pull.repo])).values(),
];
