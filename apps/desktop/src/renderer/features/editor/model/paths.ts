/** Paths as the editor shows them: from the Workspace's root, else from `~`, else the whole path. */
import { pathSegments, pathWithin } from "../../../../shared/hostPath.ts";

/** macOS spells /var, /tmp and /etc both ways; a realpath under one is the same file. */
const PRIVATE = /^\/private(?=\/(?:var|tmp|etc)\/)/;

const under = (path: string, dir: string) => {
  const plain = (p: string) => p.replace(PRIVATE, "");
  const rest = pathWithin(plain(path), plain(dir));

  return rest === "" ? null : rest;
};

const segments = (path: string) => [...pathSegments(path)];

/**
 * Inside the root: its relative segments. Elsewhere (a Worktree, a checkout's other
 * files): from `~` when it is under the Host's home, else from `/` (DESIGN.md, Editor).
 */
export const crumbs = (
  path: string,
  root: string,
  home: string | null = null
): ReadonlyArray<string> => {
  const inRoot = under(path, root);

  if (inRoot !== null) return segments(inRoot);
  const inHome = home === null ? null : under(path, home);

  return inHome === null ? segments(path) : ["~", ...segments(inHome)];
};
