/**
 * What the Review Checkout chip remembers in this window: the last used Host per repository
 * (kept across launches), each pull request's GitHub node id (to keep watching it after it
 * leaves the open list), what was removed, and removals waiting on a discard.
 */
import { Option, Schema } from "effect";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { RemovedFacts } from "./model/chip.ts";

const STORAGE_KEY = "polaris.review.checkouts.v1";

/** Node ids kept at most; the oldest go first. */
const PULL_IDS_KEPT = 200;

const Saved = Schema.Struct({
  lastHost: Schema.Record(Schema.String, Schema.String),
  pullIds: Schema.Record(Schema.String, Schema.String),
});

const decodeSaved = Schema.decodeUnknownOption(Schema.fromJsonString(Saved));

export interface CheckoutMemory {
  /** `owner/name` (lowercased) → the Host key last used to check it out. */
  readonly lastHost: Readonly<Record<string, string>>;
  /** `owner/name#n` (lowercased) → the pull request's node id. */
  readonly pullIds: Readonly<Record<string, string>>;
  /** `owner/name#n` → what this window removed, shown until it is checked out again. */
  readonly removed: Readonly<Record<string, RemovedFacts>>;
  /** Checkouts (`hostKey checkoutId`) to remove once a discard has settled them. */
  readonly removeAfterDiscard: ReadonlySet<string>;
  /** Checkouts (`hostKey checkoutId`) whose run starts again, with its command, after an update. */
  readonly restartAfterUpdate: Readonly<Record<string, string>>;
}

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const load = (): Pick<CheckoutMemory, "lastHost" | "pullIds"> => {
  try {
    return Option.getOrElse(decodeSaved(storage()?.getItem(STORAGE_KEY) ?? ""), () => ({
      lastHost: {},
      pullIds: {},
    }));
  } catch {
    return { lastHost: {}, pullIds: {} };
  }
};

export const checkoutMemory = createStore<CheckoutMemory>(() => ({
  ...load(),
  removed: {},
  removeAfterDiscard: new Set(),
  restartAfterUpdate: {},
}));

checkoutMemory.subscribe((now, before) => {
  if (now.lastHost === before.lastHost && now.pullIds === before.pullIds) return;

  try {
    storage()?.setItem(
      STORAGE_KEY,
      JSON.stringify({ lastHost: now.lastHost, pullIds: now.pullIds })
    );
  } catch {
    // Storage can be full or blocked: the first connected Host is the default again.
  }
});

export const useCheckoutMemory = <A>(select: (memory: CheckoutMemory) => A): A =>
  useStore(checkoutMemory, select);

export const repoName = (repo: { readonly owner: string; readonly name: string }) =>
  `${repo.owner}/${repo.name}`.toLowerCase();

export const rememberHost = (repo: string, hostKey: string) =>
  checkoutMemory.setState((s) =>
    s.lastHost[repo] === hostKey ? s : { lastHost: { ...s.lastHost, [repo]: hostKey } }
  );

/** Adds node ids seen in the PR list or a detail; unchanged ones don't touch storage. */
export const rememberPullIds = (ids: ReadonlyArray<readonly [string, string]>) =>
  checkoutMemory.setState((s) => {
    const fresh = ids.filter(([name, id]) => s.pullIds[name] !== id);

    if (fresh.length === 0) return s;
    const entries = [...Object.entries(s.pullIds), ...fresh];

    return { pullIds: Object.fromEntries(entries.slice(-PULL_IDS_KEPT)) };
  });

export const rememberRemoved = (pull: string, facts: RemovedFacts) =>
  checkoutMemory.setState((s) => ({ removed: { ...s.removed, [pull]: facts } }));

export const forgetRemoved = (pull: string) =>
  checkoutMemory.setState((s) => {
    if (s.removed[pull] === undefined) return s;
    const { [pull]: _, ...rest } = s.removed;

    return { removed: rest };
  });

export const setRemoveAfterDiscard = (key: string, on: boolean) =>
  checkoutMemory.setState((s) => {
    const next = new Set(s.removeAfterDiscard);

    if (on) next.add(key);
    else next.delete(key);

    return { removeAfterDiscard: next };
  });

export const setRestartAfterUpdate = (key: string, command: string | null) =>
  checkoutMemory.setState((s) => {
    const { [key]: _, ...rest } = s.restartAfterUpdate;

    return { restartAfterUpdate: command === null ? rest : { ...rest, [key]: command } };
  });
