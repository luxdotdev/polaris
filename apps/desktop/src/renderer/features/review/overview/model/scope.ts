/**
 * The commit Changes is narrowed to, per Review (picked in Commits); none shows the whole
 * pull request. Its parent is the commit before it, or the merge base for the first.
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { CommitView } from "./types.ts";

export interface CommitScope {
  readonly oid: string;
  readonly parent: string;
  readonly headline: string;
}

export const scopeStore = createStore<Readonly<Record<string, CommitScope | null>>>(() => ({}));

export const useCommitScope = (subjectKey: string): CommitScope | null =>
  useStore(scopeStore, (s) => s[subjectKey] ?? null);

export const setCommitScope = (subjectKey: string, scope: CommitScope | null) =>
  scopeStore.setState({ [subjectKey]: scope });

/** The scope for `commits[index]`; null when its parent isn't known. */
export const scopeOf = (
  commits: ReadonlyArray<CommitView>,
  index: number,
  mergeBase: string | null
): CommitScope | null => {
  const commit = commits[index];
  const parent = index === 0 ? mergeBase : (commits[index - 1]?.oid ?? null);

  return commit === undefined || parent === null
    ? null
    : { oid: commit.oid, parent, headline: commit.headline };
};
