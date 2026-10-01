/**
 * The PR list's risk lanes: a summary this window follows (`riskStore`, from an open Review)
 * wins; otherwise the Host's cached summary for the pull request's Review Checkout at its
 * head (`review.riskSummary` by key), asked once per checkout head. "Not run" without either.
 */
import { RiskSummaryKey, RiskSummaryRef } from "@polaris/protocol";
import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { polaris } from "../../bridge.ts";
import { riskStore } from "../../risk/data/riskStore.ts";
import type { FoundCheckout } from "../model/checkouts.ts";
import { laneOf, NOT_RUN, type RiskLane, type SummaryFacts } from "../model/risk.ts";

/** `pull:<pullKey>` → the cached summary's facts (null: none cached), per checkout head. */
interface Cached {
  readonly head: string;
  readonly facts: SummaryFacts | null;
}

const cachedStore = createStore<Readonly<Record<string, Cached>>>(() => ({}));

const asked = new Set<string>();

const ask = (subjectKey: string, found: FoundCheckout) => {
  const { checkout, hostKey, repo } = found;

  if (checkout.head === null || checkout.mergeBase === null) return;

  const once = `${hostKey}/${checkout.id}/${checkout.head}`;

  if (asked.has(once)) return;
  asked.add(once);

  const key = RiskSummaryKey.make({
    repo,
    mergeBase: checkout.mergeBase,
    head: checkout.head,
    since: null,
  });

  const head = checkout.head;

  void polaris()
    .request("review.riskSummary", { hostKey, ref: RiskSummaryRef.cases.ByKey.make({ key }) })
    .then((result) => {
      // An older Daemon or a Host away: try again on the next head or launch.
      if (!result.ok) {
        asked.delete(once);

        return;
      }

      cachedStore.setState({ [subjectKey]: { head, facts: result.value } });
    });
};

/** `riskOf` for the list model; asks the Hosts for what isn't known yet. */
export const useRiskLanes = (
  checkouts: ReadonlyMap<string, FoundCheckout>
): ((subjectKey: string) => RiskLane) => {
  const live = useStore(riskStore);
  const cached = useStore(cachedStore);

  useEffect(() => {
    for (const [pull, found] of checkouts) ask(`pull:${pull}`, found);
  }, [checkouts]);

  return useMemo(() => {
    const heads = new Map(
      [...checkouts].map(([pull, found]) => [`pull:${pull}`, found.checkout.head])
    );

    return (subjectKey: string) => {
      const state = live[subjectKey];

      if (state?.kind === "ready") return laneOf(state.summary);

      const entry = cached[subjectKey];

      // A cached summary for an older head says nothing about the pull request now.
      return entry === undefined || entry.head !== heads.get(subjectKey)
        ? NOT_RUN
        : laneOf(entry.facts);
    };
  }, [live, cached, checkouts]);
};
