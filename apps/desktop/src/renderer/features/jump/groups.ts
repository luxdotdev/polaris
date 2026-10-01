/**
 * The jump menu's sections (Paper AR-0): with no query, Recent, then what
 * Needs You, then actions; with a query, Sessions (Needs You first),
 * Workspaces, Worktrees, Machines and Actions, each ranked and capped.
 */
import type { JumpItem } from "./items.ts";
import { rank } from "./ranking.ts";

export interface JumpGroup {
  readonly heading: string;
  readonly items: ReadonlyArray<JumpItem>;
}

export interface JumpSources {
  readonly sessions: ReadonlyArray<JumpItem>;
  readonly workspaces: ReadonlyArray<JumpItem>;
  readonly worktrees: ReadonlyArray<JumpItem>;
  readonly hosts: ReadonlyArray<JumpItem>;
  readonly actions: ReadonlyArray<JumpItem>;
  /** Review only: pull requests, the open Review's files and its findings. */
  readonly review?: ReviewSources | undefined;
}

export interface ReviewSources {
  readonly pulls: ReadonlyArray<JumpItem>;
  readonly files: ReadonlyArray<JumpItem>;
  readonly findings: ReadonlyArray<JumpItem>;
}

/** Findings the menu shows with no query, in Review. */
const FINDINGS_SHOWN = 5;

export interface GroupsInput {
  readonly query: string;
  readonly sources: JumpSources;
  /** Recent item ids, newest first. */
  readonly recent: ReadonlyArray<string>;
}

const RECENT_SHOWN = 5;

const nonEmpty = (groups: ReadonlyArray<JumpGroup>) => groups.filter((g) => g.items.length > 0);

export const jumpGroups = ({ query, sources, recent }: GroupsInput): ReadonlyArray<JumpGroup> => {
  const recency = (item: JumpItem) => {
    const at = recent.indexOf(item.id);

    return at === -1 ? Number.POSITIVE_INFINITY : at;
  };

  if (query.trim() === "") {
    const reachable = new Map([...sources.sessions, ...sources.workspaces].map((i) => [i.id, i]));

    const recentItems = recent
      .flatMap((id) => {
        const item = reachable.get(id);

        return item === undefined ? [] : [item];
      })
      .slice(0, RECENT_SHOWN);

    const shown = new Set(recentItems.map((i) => i.id));

    return nonEmpty([
      { heading: "Recent", items: recentItems },
      {
        heading: "Needs you",
        items: sources.sessions.filter((s) => s.needsYou && !shown.has(s.id)),
      },
      { heading: "Findings", items: (sources.review?.findings ?? []).slice(0, FINDINGS_SHOWN) },
      { heading: "Actions", items: sources.actions },
    ]);
  }

  const ranked = (items: ReadonlyArray<JumpItem>, limit: number, urgent = false) =>
    rank({ query, items, recency, limit, urgent: (i: JumpItem) => urgent && i.needsYou });

  return nonEmpty([
    { heading: "Pull requests", items: ranked(sources.review?.pulls ?? [], 5) },
    { heading: "Files", items: ranked(sources.review?.files ?? [], 6) },
    { heading: "Findings", items: ranked(sources.review?.findings ?? [], 5) },
    { heading: "Sessions", items: ranked(sources.sessions, 6, true) },
    { heading: "Workspaces", items: ranked(sources.workspaces, 5) },
    { heading: "Worktrees", items: ranked(sources.worktrees, 4) },
    { heading: "Machines", items: ranked(sources.hosts, 4) },
    { heading: "Actions", items: ranked(sources.actions, 5) },
  ]);
};
