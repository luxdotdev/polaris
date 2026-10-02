/** Paths as the editor shows them: from the Workspace's root, else the whole path. */

/** Inside the root: its relative segments; elsewhere (a Worktree, a checkout): from `/`. */
export const crumbs = (path: string, root: string): ReadonlyArray<string> => {
  const base = root.endsWith("/") ? root : `${root}/`;
  const relative = path.startsWith(base) ? path.slice(base.length) : path.replace(/^\/+/, "");

  return relative.split("/").filter((s) => s.length > 0);
};
