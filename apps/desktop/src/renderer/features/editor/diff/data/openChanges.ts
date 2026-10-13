/**
 * Opening a diff from what git says about a file: the Changes tab's rows, and "Open changes"
 * for the file in the editor (its working-tree changes first, else its staged ones).
 */
import type { GitStatus } from "@polaris/ui";
import { useEffect } from "react";
import { useApp, useCommands } from "../../../../shell/hooks.ts";
import type { GitFacts } from "../../explorer/data/store.ts";
import { explorerKey, useExplorerState } from "../../explorer/data/store.ts";
import { type StatusEntry, statusOf } from "../../explorer/model/git.ts";
import { join } from "../../explorer/model/paths.ts";
import { type DiffSide, type DiffTarget, targetOf } from "../model/target.ts";
import { openDiff } from "./tabs.ts";

/** Hosts whose Daemon reads files at a revision (`git.show`) can show diffs. */
export const useCanDiff = (hostKey: string) =>
  useApp(
    (s) => s.hosts.find((h) => h.key === hostKey)?.status.capabilities.includes("git.show") === true
  );

const sideStatus = (entry: StatusEntry, side: DiffSide): GitStatus | null => {
  if (side === "head") return statusOf(entry);

  if (entry.index === "?") return side === "unstaged" ? "untracked" : null;

  const status =
    side === "staged"
      ? entry.index === "."
        ? null
        : statusOf({ ...entry, worktree: "." })
      : entry.worktree === "."
        ? null
        : statusOf({ ...entry, index: "." });

  return statusOf(entry) === "conflicted" ? "conflicted" : status;
};

/** The diff of `path` on `side`, from git's status; null when that side has no change. */
export const changeTarget = (
  place: { readonly hostKey: string; readonly workspaceId: string },
  git: GitFacts,
  path: string,
  side: DiffSide
): DiffTarget | null => {
  const entry = git.entries.find((e) => join(git.toplevel, e.path.replace(/\/$/, "")) === path);
  const status = entry === undefined ? null : sideStatus(entry, side);

  return entry === undefined || status === null
    ? null
    : targetOf({ ...place, toplevel: git.toplevel }, entry, side, status);
};

export type ChangeOpener = (side: DiffSide, path: string, pin: boolean) => void;

/**
 * Opens a Changes row's diff, or the file when git has no diff for it (an untracked
 * folder); null on a Host that can't show diffs, so rows open files as before.
 */
export const useChangeOpener = (
  place: { readonly hostKey: string; readonly workspaceId: string },
  git: GitFacts | "none" | null,
  openFile: (path: string, pin: boolean) => void
): ChangeOpener | null => {
  const canDiff = useCanDiff(place.hostKey);

  if (!canDiff || git === null || git === "none") return null;

  return (side, path, pin) => {
    const target = changeTarget(place, git, path, side);

    if (target === null) openFile(path, pin);
    else openDiff(target, pin);
  };
};

/** "Open changes" for the file in the editor: its unstaged diff, else its staged one. */
export const useOpenChanges = (hostKey: string, workspaceId: string, path: string | null) => {
  const commands = useCommands();
  const git = useExplorerState(explorerKey(hostKey, workspaceId)).git;
  const canDiff = useCanDiff(hostKey);

  useEffect(() => {
    const target = () => {
      if (path === null || git === null || git === "none" || !canDiff) return null;
      const place = { hostKey, workspaceId };

      return changeTarget(place, git, path, "unstaged") ?? changeTarget(place, git, path, "staged");
    };

    return commands.register({
      "git.openChanges": {
        run: () => {
          const found = target();

          if (found !== null) openDiff(found, true);
        },
        enabled: () => target() !== null,
      },
    });
  }, [commands, hostKey, workspaceId, path, git, canDiff]);
};
