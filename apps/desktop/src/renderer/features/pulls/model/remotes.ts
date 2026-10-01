/**
 * A Workspace's git remotes, read from its git config on the Host (`files.read`): the
 * Daemon has no remotes call, and the config is all the PR list needs. Pure parsing here;
 * `readRemotes` takes the reader so it is tested without a Host.
 */

const SECTION = /^\s*\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]\s*$/;

const ENTRY = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.*?)\s*$/;

/** Every remote's `url` (and `pushurl`) in a git config file, in file order, once each. */
export const remotesInConfig = (text: string): ReadonlyArray<string> => {
  const urls: Array<string> = [];
  let inRemote = false;

  for (const line of text.split(/\r?\n/)) {
    const section = SECTION.exec(line);

    if (section !== null) {
      inRemote = section[1]?.toLowerCase() === "remote" && section[2] !== undefined;
      continue;
    }

    const entry = ENTRY.exec(line);
    const key = entry?.[1]?.toLowerCase();
    const value = entry?.[2]?.replace(/^"(.*)"$/, "$1");

    if (!inRemote || value === undefined || value === "") continue;

    if ((key === "url" || key === "pushurl") && !urls.includes(value)) urls.push(value);
  }

  return urls;
};

/** A Worktree's `.git` file: `gitdir: <path>`; null for anything else. */
export const gitdirOf = (text: string): string | null => {
  const match = /^gitdir:\s*(.+?)\s*$/m.exec(text);

  return match?.[1] ?? null;
};

/** POSIX `path.resolve(base, rel)` without Node: Hosts are macOS or Linux. */
export const resolvePath = (base: string, rel: string): string => {
  const parts = rel.startsWith("/") ? [] : base.split("/");

  for (const part of rel.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }

  return `/${parts.filter((p) => p !== "").join("/")}`;
};

/** Reads a text file on the Host; null when it is missing, a directory or unreadable. */
export type ReadText = (path: string) => Promise<string | null>;

/**
 * The remotes of the repository at `path`: `.git/config`, or for a linked Worktree its
 * `.git` file → `gitdir` → `commondir` → `config`.
 */
export const readRemotes = async (path: string, read: ReadText): Promise<ReadonlyArray<string>> => {
  const root = path.replace(/\/+$/, "");
  const config = await read(`${root}/.git/config`);

  if (config !== null) return remotesInConfig(config);

  const dotGit = await read(`${root}/.git`);
  const gitdir = dotGit === null ? null : gitdirOf(dotGit);

  if (gitdir === null) return [];

  const absolute = resolvePath(root, gitdir);
  const common = (await read(`${absolute}/commondir`))?.trim();

  const commonDir =
    common === undefined || common === "" ? absolute : resolvePath(absolute, common);

  return remotesInConfig((await read(`${commonDir}/config`)) ?? "");
};
