/**
 * The jump menu's sections (Paper AR-0): with no query, Recent, then what
 * Needs You; with a query, Sessions (Needs You first), Workspaces, Worktrees
 * and Machines, each ranked and capped. Navigation only: commands are the palette's.
 */
import type { JumpItem } from "./items.ts";
import { itemScore, rank } from "./ranking.ts";

export interface JumpGroup {
  readonly heading: string;
  readonly items: ReadonlyArray<JumpItem>;
  /** Everything that matched, before the cap; more than `items.length` when some were cut. */
  readonly matched: number;
}

export interface JumpSources {
  readonly sessions: ReadonlyArray<JumpItem>;
  readonly workspaces: ReadonlyArray<JumpItem>;
  readonly worktrees: ReadonlyArray<JumpItem>;
  readonly hosts: ReadonlyArray<JumpItem>;
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

type Section = Omit<JumpGroup, "matched"> & { readonly matched?: number };

const nonEmpty = (groups: ReadonlyArray<Section>): ReadonlyArray<JumpGroup> =>
  groups.flatMap((g) =>
    g.items.length === 0 ? [] : [{ ...g, matched: g.matched ?? g.items.length }]
  );

/** Every item the menu searches, for its footer's "6 of 41". */
export const searchedCount = ({ sessions, workspaces, worktrees, hosts, review }: JumpSources) =>
  sessions.length +
  workspaces.length +
  worktrees.length +
  hosts.length +
  (review === undefined ? 0 : review.pulls.length + review.files.length + review.findings.length);

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
    ]);
  }

  const section = (
    heading: string,
    items: ReadonlyArray<JumpItem>,
    limit: number,
    urgent = false
  ): Section => ({
    heading,
    items: rank({ query, items, recency, limit, urgent: (i: JumpItem) => urgent && i.needsYou }),
    matched: items.filter((i) => itemScore(query, i) !== null).length,
  });

  return nonEmpty([
    section("Pull requests", sources.review?.pulls ?? [], 5),
    section("Files", sources.review?.files ?? [], 6),
    section("Findings", sources.review?.findings ?? [], 5),
    section("Sessions", sources.sessions, 6, true),
    section("Workspaces", sources.workspaces, 5),
    section("Worktrees", sources.worktrees, 4),
    section("Machines", sources.hosts, 4),
  ]);
};
