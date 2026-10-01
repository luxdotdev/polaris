/**
 * The tabs over Review's centre pane: Overview · Changes · Conversation · Commits · Checks
 * for a pull request, Overview · Changes for an Agent Session. Every Review opens on
 * Overview; the tab picked last is remembered per Review while the app runs.
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { CheckRunView, PullOverviewView, TimelineItemView } from "./types.ts";

export type TabId = "overview" | "changes" | "conversation" | "commits" | "checks";

export const PULL_TABS: ReadonlyArray<TabId> = [
  "overview",
  "changes",
  "conversation",
  "commits",
  "checks",
];

export const SESSION_TABS: ReadonlyArray<TabId> = ["overview", "changes"];

export const TAB_LABELS: Readonly<Record<TabId, string>> = {
  overview: "Overview",
  changes: "Changes",
  conversation: "Conversation",
  commits: "Commits",
  checks: "Checks",
};

/** The tab `step` places from `current`, wrapping at either end (⌘⇧[ / ⌘⇧]). */
export const cycleTab = (tabs: ReadonlyArray<TabId>, current: TabId, step: 1 | -1): TabId => {
  const at = Math.max(0, tabs.indexOf(current));

  return tabs[(at + step + tabs.length) % tabs.length] ?? current;
};

/** Comments a person or bot wrote: each comment, each review with a body, each thread reply. */
export const commentCount = (timeline: ReadonlyArray<TimelineItemView>) =>
  timeline.reduce((n, item) => {
    if (item.kind === "comment") return n + 1;

    if (item.kind === "review") return n + (item.body.trim() === "" ? 0 : 1);

    return item.kind === "thread" ? n + item.comments.length : n;
  }, 0);

const isPassing = (run: CheckRunView) =>
  run.status === "completed" &&
  (run.conclusion === "success" || run.conclusion === "neutral" || run.conclusion === "skipped");

const isFailing = (run: CheckRunView) =>
  run.status === "completed" &&
  run.conclusion !== null &&
  !isPassing(run) &&
  run.conclusion !== "stale";

/** The Checks tab's figure: "4 of 4 passed", "1 failing", "2 running", or nothing. */
export const checksLabel = (runs: ReadonlyArray<CheckRunView>): string | null => {
  if (runs.length === 0) return null;
  const failing = runs.filter(isFailing).length;

  if (failing > 0) return `${failing} failing`;
  const running = runs.filter((r) => r.status !== "completed").length;

  if (running > 0) return `${running} running`;

  return `${runs.filter(isPassing).length} of ${runs.length} passed`;
};

export { isFailing as isFailingRun, isPassing as isPassingRun };

/** The figure after each tab's label; a tab without one shows none. */
export const tabFigures = (
  files: number | null,
  overview: PullOverviewView | null
): Readonly<Partial<Record<TabId, string>>> => {
  const figures: Partial<Record<TabId, string>> = {};

  if (files !== null) figures.changes = `${files}`;

  if (overview === null) return figures;

  figures.conversation = `${commentCount(overview.timeline)}`;
  figures.commits = `${overview.commits.length}`;
  const checks = checksLabel(overview.checkRuns);

  if (checks !== null) figures.checks = checks;

  return figures;
};

export const tabStore = createStore<Readonly<Record<string, TabId>>>(() => ({}));

export const tabOf = (subjectKey: string): TabId => tabStore.getState()[subjectKey] ?? "overview";

export const setTab = (subjectKey: string, tab: TabId) => tabStore.setState({ [subjectKey]: tab });

export const useTab = (subjectKey: string): TabId =>
  useStore(tabStore, (s) => s[subjectKey] ?? "overview");
