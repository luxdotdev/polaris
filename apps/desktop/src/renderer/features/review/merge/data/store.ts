/**
 * A pull request's merge state and reviewers (`github.pull.actions`), fetched when its
 * Review opens and again whenever its detail changes on the poll (head, state, checks), or
 * after a reviewer request or a merge. No timers of its own.
 */
import { useEffect } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { IpcError } from "../../../../../shared/api.ts";
import type { PullRef } from "../../../../../shared/github.ts";
import type { PullActionsView } from "../../../../../shared/githubActions.ts";
import { polaris } from "../../../bridge.ts";
import type { ReviewSubject } from "../../../../routes/review.ts";
import { pullKey } from "../../data/pullDetail.ts";
import { mergeLeads } from "../model/merge.ts";

export type ActionsState =
  | { readonly kind: "loading" }
  | { readonly kind: "ok"; readonly view: PullActionsView }
  | { readonly kind: "failed"; readonly error: IpcError };

export const actionsStore = createStore<Readonly<Record<string, ActionsState>>>(() => ({}));

const LOADING: ActionsState = { kind: "loading" };

/** Asks GitHub again; keeps the last view while it loads, and on a failure after one. */
export const refreshActions = async (pull: PullRef) => {
  const key = pullKey(pull);

  const result = await polaris().request("github.pull.actions", {
    pull: { repo: pull.repo, number: pull.number },
  });

  if (result.ok) actionsStore.setState({ [key]: { kind: "ok", view: result.value } });
  else if (actionsStore.getState()[key]?.kind !== "ok")
    actionsStore.setState({ [key]: { kind: "failed", error: result.error } });
};

/** The pull request's actions, fetched again whenever `signature` (its detail) changes. */
export const usePullActions = (pull: PullRef, signature: string): ActionsState => {
  const current = useStore(actionsStore, (s) => s[pullKey(pull)]);
  const { owner, name, host } = pull.repo;
  const { number } = pull;

  useEffect(() => {
    if (signature === "") return;
    const repo = host === undefined ? { owner, name } : { host, owner, name };

    void refreshActions({ repo, number });
  }, [owner, name, host, number, signature]);

  return current ?? LOADING;
};

/** The loaded view, never fetching. */
export const useLoadedActions = (pull: PullRef): PullActionsView | null =>
  useStore(actionsStore, (s) => {
    const state = s[pullKey(pull)];

    return state?.kind === "ok" ? state.view : null;
  });

export const loadedActions = (pull: PullRef): PullActionsView | null => {
  const state = actionsStore.getState()[pullKey(pull)];

  return state?.kind === "ok" ? state.view : null;
};

/** Merge leads the header (Submit review steps back): see `mergeLeads`. */
export const useMergeLeads = (subject: ReviewSubject): boolean =>
  useStore(actionsStore, (s) => {
    if (subject.kind !== "pull") return false;
    const state = s[pullKey(subject.pull)];

    return state?.kind === "ok" && mergeLeads(state.view.merge, state.view.reviewers);
  });
