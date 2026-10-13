/**
 * The merge popover's choices, remembered per GitHub account on this Mac: which follow-ups
 * run after a merge, and the method last used per repository. Kept in `localStorage`; the
 * defaults stand when it can't be read.
 */
import { Option, Schema } from "effect";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { MergeMethod } from "../../../../../shared/githubActions.ts";

const KEY = "polaris.review.merge.v1";

const Method = Schema.Literals(["merge", "squash", "rebase"]);

const Prefs = Schema.Struct({
  /** Delete the head branch on GitHub. */
  deleteBranch: Schema.Boolean,
  /** Remove the Review Checkout. */
  removeCheckout: Schema.Boolean,
  /** Delete the local branch of the agent session the pull request came from. */
  deleteLocalBranch: Schema.Boolean,
  /** `owner/name` (lowercased) → the method last used there. */
  methods: Schema.Record(Schema.String, Method),
});

export type MergePrefs = typeof Prefs.Type;

export const DEFAULT_PREFS: MergePrefs = {
  deleteBranch: true,
  removeCheckout: true,
  deleteLocalBranch: false,
  methods: {},
};

const decode = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Prefs))
);

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const read = (): Readonly<Record<string, MergePrefs>> => {
  try {
    return Option.getOrElse(decode(storage()?.getItem(KEY) ?? "{}"), () => ({}));
  } catch {
    return {};
  }
};

export const mergePrefsStore = createStore<Readonly<Record<string, MergePrefs>>>(() => read());

export const prefsOf = (login: string): MergePrefs =>
  mergePrefsStore.getState()[login] ?? DEFAULT_PREFS;

export const useMergePrefs = (login: string): MergePrefs =>
  useStore(mergePrefsStore, (s) => s[login] ?? DEFAULT_PREFS);

export const setMergePrefs = (login: string, patch: Partial<MergePrefs>) => {
  const next = { ...mergePrefsStore.getState(), [login]: { ...prefsOf(login), ...patch } };

  mergePrefsStore.setState(next);

  try {
    storage()?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not remembered this time; it still holds in this window.
  }
};

/** Remembers the method used in `repo`, for its next merge. */
export const rememberMethod = (login: string, repo: string, method: MergeMethod) =>
  setMergePrefs(login, { methods: { ...prefsOf(login).methods, [repo.toLowerCase()]: method } });
