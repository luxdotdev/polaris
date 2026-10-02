/**
 * The explorer's reads from the Host: folder listings and `git.status`,
 * fetched when the tree needs them and again on each burst of file changes
 * (`files.watch`, shared with Output). Nothing here runs on a timer.
 */
import { useEffect } from "react";
import { polaris } from "../../../bridge.ts";
import { useFilesTick } from "../../../session/index.ts";
import { gitMarks } from "../model/git.ts";
import { dirname, join } from "../model/paths.ts";
import { foldersToList, type TreeInput } from "../model/tree.ts";
import { explorerOf, patchExplorer, setListing } from "./store.ts";

const list = async (key: string, hostKey: string, dir: string) => {
  const result = await polaris().request("files.listDir", { hostKey, path: dir });

  setListing(
    key,
    dir,
    result.ok
      ? {
          kind: "ready",
          entries: result.value.map(({ name, path, kind }) => ({ name, path, kind })),
        }
      : { kind: "error", message: result.error.message }
  );
};

/** Lists the folders the tree needs and hasn't asked for yet. */
export const useListings = (key: string, hostKey: string, input: TreeInput) => {
  const wanted = foldersToList(input).join("\n");

  useEffect(() => {
    for (const dir of wanted.split("\n")) {
      if (explorerOf(key).listings.has(dir)) continue;
      setListing(key, dir, { kind: "loading" });
      void list(key, hostKey, dir);
    }
  }, [key, hostKey, wanted]);
};

/** Where git's paths start: the nearest folder at or above `root` holding `.git`. */
const toplevels = new Map<string, Promise<string | null>>();

/** Top levels whose `.git` is a file: linked worktrees, which the status bar names. */
const linked = new Set<string>();

const findToplevel = async (hostKey: string, root: string): Promise<string | null> => {
  for (let dir = root; ; dir = dirname(dir)) {
    const found = await polaris().request("files.stat", { hostKey, path: join(dir, ".git") });

    if (found.ok) {
      if (found.value.kind === "file") linked.add(`${hostKey}\u0000${dir}`);

      return dir;
    }

    if (dir === "/") return null;
  }
};

/** The repository's top level at or above `root`, found once per folder; null outside git. */
export const toplevelOf = (hostKey: string, root: string) => {
  const cacheKey = `${hostKey}\u0000${root}`;
  const known = toplevels.get(cacheKey) ?? findToplevel(hostKey, root);

  toplevels.set(cacheKey, known);

  return known;
};

const refreshGit = async (key: string, hostKey: string, root: string) => {
  const toplevel = await toplevelOf(hostKey, root);

  if (toplevel === null) {
    patchExplorer(key, () => ({ git: "none" }));

    return;
  }

  const result = await polaris().request("git.status", { hostKey, cwd: root });

  patchExplorer(key, () => ({
    git: result.ok
      ? {
          toplevel,
          worktree: linked.has(`${hostKey}\u0000${toplevel}`),
          head: result.value.head,
          branch: result.value.branch,
          ahead: result.value.ahead,
          marks: gitMarks(toplevel, root, result.value.entries),
        }
      : "none",
  }));
};

/** Re-lists what's on screen and refetches git status on each burst of file changes. */
export const useRefresh = (key: string, hostKey: string, root: string) => {
  const tick = useFilesTick(hostKey, root);

  useEffect(() => {
    void refreshGit(key, hostKey, root);

    // The first run is the mount: listings are fresh from useListings.
    if (tick === 0) return;
    const { listings } = explorerOf(key);

    for (const [dir, listing] of listings) {
      if (listing.kind !== "loading") void list(key, hostKey, dir);
    }
  }, [key, hostKey, root, tick]);
};
