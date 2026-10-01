/**
 * Overview's data: a pull request's description, timeline, commits, checks and bot summary
 * from the detail Review already loads, and the walkthroughs and a session's prompts from
 * the Risk Summary. Fields an older main or Daemon leaves out read as empty.
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { PullDetailView } from "../../../../../shared/github.ts";
import { useRisk } from "../../../risk/data/riskStore.ts";
import type { Summary } from "../../../risk/model/summary.ts";
import type { PullOverviewView, TurnPromptView, WalkthroughView } from "../model/types.ts";

/** On the wire the commit list is `commitList`: `commits` already counts them. */
type OverviewFields = Omit<PullOverviewView, "body" | "commits"> & {
  readonly commitList: PullOverviewView["commits"];
};

type Wire<T> = { readonly [K in keyof T]?: T[K] | null | undefined };

export const overviewOf = (
  detail: Pick<PullDetailView, "body"> & Wire<OverviewFields>
): PullOverviewView => ({
  body: detail.body,
  timeline: detail.timeline ?? [],
  commits: detail.commitList ?? [],
  checkRuns: detail.checkRuns ?? [],
  botSummary: detail.botSummary ?? null,
  viewerLastReview: detail.viewerLastReview ?? null,
  published: detail.published ?? null,
});

export interface Walkthroughs {
  readonly full: WalkthroughView | null;
  /** On a re-review: what the commits since the last one change. */
  readonly delta: WalkthroughView | null;
  /** An Agent Session's prompts for the Turns under review. */
  readonly prompts: ReadonlyArray<TurnPromptView>;
}

const NONE: Walkthroughs = { full: null, delta: null, prompts: [] };

const fromSummary = (summary: Summary): Walkthroughs => ({
  full: summary.walkthrough ?? null,
  delta: summary.deltaWalkthrough ?? null,
  prompts: summary.prompts ?? [],
});

/** Preview scenes set these per Review; a real Review reads its Risk Summary. */
export const walkthroughScenes = createStore<Readonly<Record<string, Walkthroughs>>>(() => ({}));

export const useWalkthroughs = (subjectKey: string): Walkthroughs => {
  const risk = useRisk(subjectKey);
  const scene = useStore(walkthroughScenes, (s) => s[subjectKey]);

  if (scene !== undefined) return scene;

  return risk.kind === "ready" ? fromSummary(risk.summary) : NONE;
};
