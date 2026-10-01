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

const pairOf = (held: Held | null) => {
  const head = held?.checkout.head ?? null;
  const latest = held?.checkout.latestHead ?? "";

  return head === null || latest === "" || head === latest ? null : { base: head, head: latest };
};

export const useNewCommits = (held: Held | null, pull: OpenPull): CompareView | null => {
  const pair = pairOf(held);
  const { owner, name } = pull.repo;
  const key = pair === null ? null : `${owner}/${name}:${pair.base}...${pair.head}`.toLowerCase();
  const view = useStore(comparisons, (s) => (key === null ? null : (s[key] ?? null)));

  const base = pair?.base ?? null;
  const head = pair?.head ?? null;

  useEffect(() => {
    if (key === null || base === null || head === null || key in comparisons.getState()) return;

    void polaris()
      .request("github.pull.compare", { repo: { owner, name }, base, head })
      .then((result) => comparisons.setState({ [key]: result.ok ? result.value : null }));
  }, [key, owner, name, base, head]);

  return view;
};
