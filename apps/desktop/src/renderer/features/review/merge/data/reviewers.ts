/**
 * Asking for reviews: search the people and teams the account can see (debounced), and add
 * or remove requested reviewers, refreshing the pull request's actions after each.
 */
import { useEffect, useState } from "react";
import type { PullRef } from "../../../../../shared/github.ts";
import type { ReviewerView } from "../../../../../shared/githubActions.ts";
import { polaris } from "../../../bridge.ts";
import { refreshActions } from "./store.ts";

const SEARCH_DELAY_MS = 200;

export type SearchState =
  | { readonly kind: "idle" }
  | { readonly kind: "searching" }
  | { readonly kind: "ok"; readonly results: ReadonlyArray<ReviewerView> }
  | { readonly kind: "failed"; readonly message: string };

const plain = (pull: PullRef): PullRef => ({ repo: pull.repo, number: pull.number });

/** GitHub's matches for `query`, once typing pauses; idle for an empty query. */
export const useReviewerSearch = (pull: PullRef, query: string): SearchState => {
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const trimmed = query.trim();
  const { owner, name, host } = pull.repo;
  const { number } = pull;

  useEffect(() => {
    if (trimmed === "") {
      setState({ kind: "idle" });

      return;
    }

    let live = true;

    const repo = host === undefined ? { owner, name } : { host, owner, name };

    setState({ kind: "searching" });

    const timer = setTimeout(() => {
      void polaris()
        .request("github.reviewers.search", { pull: { repo, number }, query: trimmed })
        .then((result) => {
          if (!live) return;
          setState(
            result.ok
              ? { kind: "ok", results: result.value }
              : { kind: "failed", message: result.error.message }
          );
        });
    }, SEARCH_DELAY_MS);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [owner, name, host, number, trimmed]);

  return state;
};

/** Asks `reviewer` (or stops asking); the error's message when GitHub refused. */
export const changeReviewer = async (
  pull: PullRef,
  reviewer: ReviewerView,
  add: boolean
): Promise<string | null> => {
  const change = {
    pull: plain(pull),
    users: reviewer.kind === "user" ? [reviewer.login] : [],
    teams: reviewer.kind === "team" ? [reviewer.login] : [],
  };

  const result = await polaris().request(
    add ? "github.reviewers.request" : "github.reviewers.remove",
    change
  );

  await refreshActions(pull);

  return result.ok ? null : result.error.message;
};
