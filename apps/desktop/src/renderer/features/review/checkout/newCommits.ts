/**
 * The commits an update would bring (Paper R4: "2 new commits on …"), from GitHub's comparison
 * of the checkout's commit with the pull request's head; asked once per pair.
 */
import { useEffect } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { OpenPull } from "../../../../shared/api.ts";
import type { CompareView } from "../../../../shared/github.ts";
import { polaris } from "../../bridge.ts";
import type { Held } from "./actions.ts";

/** By `owner/name:base...head`; null when GitHub couldn't compare them. */
const comparisons = createStore<Readonly<Record<string, CompareView | null>>>(() => ({}));

/**
 * What to compare: the checkout's commit with the head (what an update brings), or, before
 * the first fetch, the base with the head (what the checkout is fetching).
 */
const pairOf = (held: Held | null) => {
  if (held === null) return null;
  const { head, latestHead, latestBase } = held.checkout;
  const base = head ?? latestBase;

  return base === "" || latestHead === "" || base === latestHead
    ? null
    : { base, head: latestHead };
};

export const useNewCommits = (held: Held | null, pull: OpenPull): CompareView | null => {
  const pair = pairOf(held);
  const { owner, name, host } = pull.repo;

  const key =
    pair === null
      ? null
      : `${host ?? ""}/${owner}/${name}:${pair.base}...${pair.head}`.toLowerCase();

  const view = useStore(comparisons, (s) => (key === null ? null : (s[key] ?? null)));

  const base = pair?.base ?? null;
  const head = pair?.head ?? null;

  useEffect(() => {
    if (key === null || base === null || head === null || key in comparisons.getState()) return;

    void polaris()
      .request("github.pull.compare", {
        repo: host === undefined ? { owner, name } : { host, owner, name },
        base,
        head,
      })
      .then((result) => comparisons.setState({ [key]: result.ok ? result.value : null }));
  }, [key, host, owner, name, base, head]);

  return view;
};
