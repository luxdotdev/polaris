/**
 * The GitHub client's views in the renderer: the pull request list and the accounts, each
 * kept from its feed by `PullsPublisher`. The PR list, Needs You's Reviews group and the
 * Review tab's count read them here.
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { GitHubAccountsView, PullListView } from "../../../shared/github.ts";

export interface PullsState {
  /** Null until the first item of `github.pulls`. */
  readonly list: PullListView | null;
  readonly accounts: GitHubAccountsView | null;
  /** Notices the user answered "Not now", by key; for this launch. */
  readonly dismissed: ReadonlySet<string>;
}

export const pullsStore = createStore<PullsState>(() => ({
  list: null,
  accounts: null,
  dismissed: new Set(),
}));

export const usePulls = <A>(select: (state: PullsState) => A): A => useStore(pullsStore, select);

export const dismissNotice = (key: string) =>
  pullsStore.setState((s) => ({ dismissed: new Set([...s.dismissed, key]) }));

/** Review requested, across accounts: the Review tab's count and Needs You's Reviews group. */
export const useRequestedCount = () => usePulls((s) => s.list?.requested.length ?? 0);
