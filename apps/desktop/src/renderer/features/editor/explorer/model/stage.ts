/**
 * The Changes tab with `git.write` (Paper 15): `git.status` entries split into
 * Staged (the index against HEAD) and Changes (the worktree against the index).
 */
import type { GitStatus } from "@polaris/ui";
import type { AgentMarks } from "./agents.ts";
import { type StatusEntry, statusOf } from "./git.ts";
import { basename, dirname, isUnder, join, relative } from "./paths.ts";

export interface StageRow {
  /** Absolute; an untracked folder's path without its trailing "/". */
  readonly path: string;
  /** What `git.stage` and friends take: relative to the top level, a rename's old path too. */
  readonly paths: ReadonlyArray<string>;
  readonly name: string;
  /** The folder relative to the Workspace, "" at its top. */
  readonly folder: string;
  readonly git: GitStatus;
  /** Untracked: discarding trashes it instead of `git.discard`. */
  readonly untracked: boolean;
  readonly agent: string | null;
}

export interface StageLists {
  readonly staged: ReadonlyArray<StageRow>;
  readonly unstaged: ReadonlyArray<StageRow>;
}

const CONFLICTS = new Set(["DD", "AA", "UU", "AU", "UA", "DU", "UD"]);

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const byPlace = (a: StageRow, b: StageRow) =>
  collator.compare(a.folder, b.folder) || collator.compare(a.name, b.name);

/** Which side of the index an entry shows on: both for "MM", only Changes for a conflict. */
const sides = (entry: StatusEntry) => {
  const xy = `${entry.index}${entry.worktree}`;

  if (entry.index === "!") return { staged: null, unstaged: null };

  if (entry.index === "?") return { staged: null, unstaged: "untracked" as const };

  if (CONFLICTS.has(xy)) return { staged: null, unstaged: "conflicted" as const };

  return {
    staged: entry.index === "." ? null : statusOf({ ...entry, worktree: "." }),
    unstaged: entry.worktree === "." ? null : statusOf({ ...entry, index: "." }),
  };
};

export const stageLists = (
  toplevel: string,
  root: string,
  entries: ReadonlyArray<StatusEntry>,
  agents: AgentMarks
): StageLists => {
  const staged: Array<StageRow> = [];
  const unstaged: Array<StageRow> = [];

  for (const entry of entries) {
    const path = join(toplevel, entry.path.replace(/\/$/, ""));

    if (!isUnder(path, root) || path === root) continue;
    const side = sides(entry);

    const row = (git: GitStatus, paths: ReadonlyArray<string>): StageRow => ({
      path,
      paths,
      name: basename(path),
      folder: relative(dirname(path), root),
      git,
      untracked: git === "untracked",
      agent: agents.editing.get(path) ?? null,
    });

    if (side.staged !== null) {
      const paths = entry.origPath === null ? [entry.path] : [entry.path, entry.origPath];
      staged.push(row(side.staged, paths));
    }

    if (side.unstaged !== null) unstaged.push(row(side.unstaged, [entry.path]));
  }

  return { staged: staged.sort(byPlace), unstaged: unstaged.sort(byPlace) };
};

/** Every row's paths, for "Stage all" and "Unstage all". */
export const allPaths = (rows: ReadonlyArray<StageRow>) => rows.flatMap((row) => row.paths);

/** The commit button: "Commit 3 files"; off with no message or nothing staged. */
export const commitLabel = (staged: number) => {
  if (staged === 0) return "Commit";

  return staged === 1 ? "Commit 1 file" : `Commit ${staged} files`;
};

export const canCommit = (message: string, staged: number, running: boolean) =>
  !running && staged > 0 && message.trim() !== "";
