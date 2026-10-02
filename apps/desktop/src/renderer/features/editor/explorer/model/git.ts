/**
 * `git.status` as the explorer shows it (DESIGN.md, Editor → Git status): one
 * letter per path, a dot on every folder holding a change, and the change count.
 */
import type { GitStatus } from "@polaris/ui";
import { dirname, isUnder, join } from "./paths.ts";

/** One porcelain v2 entry, paths relative to the repository's top level. */
export interface StatusEntry {
  readonly path: string;
  readonly origPath: string | null;
  readonly index: string;
  readonly worktree: string;
}

const CONFLICTS = new Set(["DD", "AA", "UU", "AU", "UA", "DU", "UD"]);

/** The letter a porcelain XY pair shows, by precedence: conflicts first, ignored last. */
export const statusOf = ({ index, worktree }: StatusEntry): GitStatus => {
  const xy = `${index}${worktree}`;

  if (index === "?") return "untracked";

  if (index === "!") return "ignored";

  if (CONFLICTS.has(xy)) return "conflicted";

  if (index === "R") return "renamed";

  if (index === "D" || worktree === "D") return "deleted";

  if (index === "A" || index === "C") return "added";

  return "modified";
};

export interface GitMarks {
  /** Absolute path → its status; deleted files too, though they're gone from disk. */
  readonly files: ReadonlyMap<string, GitStatus>;
  /** Folders (absolute) that hold at least one change other than an ignored file. */
  readonly dirtyFolders: ReadonlySet<string>;
  /** Changes, ignored files excepted: the Changes count and the status bar's "N changed". */
  readonly changed: number;
}

export const noMarks: GitMarks = { files: new Map(), dirtyFolders: new Set(), changed: 0 };

/** Folds `git.status` entries (relative to `toplevel`) into marks for paths under `root`. */
export const gitMarks = (
  toplevel: string,
  root: string,
  entries: ReadonlyArray<StatusEntry>
): GitMarks => {
  const files = new Map<string, GitStatus>();
  const dirtyFolders = new Set<string>();
  let changed = 0;

  for (const entry of entries) {
    // Untracked folders arrive as "dir/"; the folder is the change.
    const path = join(toplevel, entry.path.replace(/\/$/, ""));

    if (!isUnder(path, root) || path === root) continue;
    const status = statusOf(entry);

    files.set(path, status);

    if (status === "ignored") continue;
    changed++;

    for (let dir = dirname(path); isUnder(dir, root) && dir !== root; dir = dirname(dir)) {
      if (dirtyFolders.has(dir)) break;
      dirtyFolders.add(dir);
    }
  }

  return { files, dirtyFolders, changed };
};

/** A path's status, inheriting an untracked or ignored folder's ("dir/" entries). */
export const statusAt = (marks: GitMarks, path: string, root: string): GitStatus | null => {
  const own = marks.files.get(path);

  if (own !== undefined) return own;

  for (let dir = dirname(path); isUnder(dir, root) && dir !== root; dir = dirname(dir)) {
    const inherited = marks.files.get(dir);

    if (inherited === "untracked" || inherited === "ignored") return inherited;
  }

  return null;
};

/** Deleted files whose folder is `dir`: listed in the tree, struck through, though not on disk. */
export const deletedIn = (marks: GitMarks, dir: string): ReadonlyArray<string> =>
  [...marks.files].flatMap(([path, status]) =>
    status === "deleted" && dirname(path) === dir ? [path] : []
  );
