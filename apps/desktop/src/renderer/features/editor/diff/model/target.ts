/**
 * What a diff tab compares (DESIGN.md, Editor: diff tabs): a changed file on one side of the
 * index. Staged compares the index with HEAD, Changes the working tree with the index, and a
 * Host that can't write git (one flat Changes list) the working tree with HEAD.
 */
import type { GitStatus } from "@polaris/ui";
import type { StatusEntry } from "../../explorer/model/git.ts";
import { basename, join } from "../../explorer/model/paths.ts";

export type DiffSide = "staged" | "unstaged" | "head";

export interface DiffTarget {
  readonly hostKey: string;
  readonly workspaceId: string;
  /** The repository's top level: `git.show` runs here and its paths start here. */
  readonly toplevel: string;
  /** Absolute: the file as it is now (its new name after a rename). */
  readonly path: string;
  readonly repoPath: string;
  /** A rename's old path, relative to `toplevel`. */
  readonly origRepoPath: string | null;
  readonly side: DiffSide;
  readonly git: GitStatus;
}

/** Where one side of the diff is read from; `none` is an empty file (added or deleted). */
export type DiffSource =
  | { readonly kind: "none" }
  | { readonly kind: "git"; readonly revision: string; readonly path: string }
  | { readonly kind: "file"; readonly path: string };

const NONE: DiffSource = { kind: "none" };

/** `git.show` with an empty revision reads `:path`, the index (stage 0). */
const INDEX = "";

const head = (target: DiffTarget): DiffSource =>
  target.git === "added" || target.git === "untracked"
    ? NONE
    : { kind: "git", revision: "HEAD", path: target.origRepoPath ?? target.repoPath };

const worktree = (target: DiffTarget): DiffSource =>
  target.git === "deleted" ? NONE : { kind: "file", path: target.path };

export interface DiffSources {
  readonly old: DiffSource;
  readonly new: DiffSource;
}

/** The old and new sides of `target`. */
export const sourcesOf = (target: DiffTarget): DiffSources => {
  if (target.side === "staged")
    return {
      old: head(target),
      new:
        target.git === "deleted" ? NONE : { kind: "git", revision: INDEX, path: target.repoPath },
    };

  if (target.side === "head") return { old: head(target), new: worktree(target) };

  return {
    old:
      target.git === "untracked" ? NONE : { kind: "git", revision: INDEX, path: target.repoPath },
    new: worktree(target),
  };
};

/** One tab per file and side: "unstaged:/abs/main.ts". */
export const diffTabId = (target: Pick<DiffTarget, "side" | "path">) =>
  `diff:${target.side}:${target.path}`;

export const isDiffTab = (id: string) => id.startsWith("diff:");

/** The Changes row a side shows as selected: the shown diff's file, else the open file. */
export const selectedPath = (side: DiffSide, shownDiff: string | null, open: string | null) => {
  if (shownDiff === null) return open;
  const prefix = `diff:${side}:`;

  return shownDiff.startsWith(prefix) ? shownDiff.slice(prefix.length) : null;
};

/** VS Code's titles: "main.ts (Working Tree)", "main.ts (Index)". */
export const diffTitle = (target: Pick<DiffTarget, "side" | "path">) =>
  `${basename(target.path)} (${target.side === "staged" ? "Index" : "Working Tree"})`;

/** What the toolbar says each side is. */
export const sideLabels = (target: Pick<DiffTarget, "side">) => {
  const old = target.side === "unstaged" ? "Index" : "HEAD";
  const fresh = target.side === "staged" ? "Index" : "Working Tree";

  return `${old} ↔ ${fresh}`;
};

/** A row's entry in `git.status` and its side, as a target; null for an untracked folder. */
export const targetOf = (
  where: { readonly hostKey: string; readonly workspaceId: string; readonly toplevel: string },
  entry: StatusEntry,
  side: DiffSide,
  git: GitStatus
): DiffTarget | null =>
  entry.path.endsWith("/")
    ? null
    : {
        ...where,
        path: join(where.toplevel, entry.path),
        repoPath: entry.path,
        origRepoPath: side === "unstaged" ? null : entry.origPath,
        side: git === "conflicted" ? "head" : side,
        git,
      };
