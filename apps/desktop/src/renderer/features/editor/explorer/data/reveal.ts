/**
 * "Show this in the explorer" from anywhere (Review's "Open in the editor", a
 * path in a transcript): a folder outside the Workspace's own (a Worktree or a
 * Review Checkout) becomes the explorer's root; anything else opens its way down.
 */
import { useEffect } from "react";
import { polaris } from "../../../bridge.ts";
import { dirname, isUnder } from "../model/paths.ts";
import { expandTo } from "../model/tree.ts";
import { explorerKey, patchExplorer } from "./store.ts";

export interface RevealTarget {
  readonly hostKey: string;
  readonly workspaceId: string;
  /** Absolute on the Host: a file or a folder. */
  readonly path: string;
}

/** Asks the Workspace's explorer to show `path`; Edit mode is the caller's to open. */
export const revealInExplorer = ({ hostKey, workspaceId, path }: RevealTarget) =>
  patchExplorer(explorerKey(hostKey, workspaceId), () => ({ reveal: path, view: "files" }));

/** Which root shows `path`: the current one if it holds it, the Workspace's, or a folder outside. */
export const rootFor = (
  path: string,
  folder: boolean,
  current: string | null,
  workspacePath: string
): string | null => {
  if (current !== null && isUnder(path, current)) return current;

  if (isUnder(path, workspacePath)) return null;

  return folder ? path : dirname(path);
};

const reveal = async (key: string, hostKey: string, workspacePath: string, path: string) => {
  const stat = await polaris().request("files.stat", { hostKey, path });
  const folder = stat.ok && stat.value.kind === "directory";

  patchExplorer(key, (s) => {
    const root = rootFor(path, folder, s.root, workspacePath);
    const shown = root ?? workspacePath;
    const expanded = expandTo(s.expanded, shown, path);

    return {
      root,
      reveal: null,
      focused: path === shown ? s.focused : path,
      expanded: folder && path !== shown ? new Set(expanded).add(path) : expanded,
    };
  });
};

export const useReveal = (
  key: string,
  hostKey: string,
  workspacePath: string,
  target: string | null
) => {
  useEffect(() => {
    if (target !== null) void reveal(key, hostKey, workspacePath, target);
  }, [key, hostKey, workspacePath, target]);
};
