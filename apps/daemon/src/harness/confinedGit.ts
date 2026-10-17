/**
 * The confined shell's git in a linked worktree: it reads the repository's objects and refs
 * but never its `config` (remote URLs and headers can carry tokens) nor other worktrees' data.
 * Git reads a config Polaris builds from an allowlist instead, through `GIT_COMMON_DIR`, in a
 * fresh directory under Polaris's state. See ADR 0055.
 */
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { isWithin } from "../files/fs.ts";
import { gitText } from "../git/git.ts";
import { paths } from "../paths.ts";

/** What git needs from the common dir to read history; `config`, hooks and logs stay out. */
const SHARED = ["objects", "refs", "packed-refs", "HEAD", "reftable", "shallow", "info"];

/** What git needs of the worktree's own git dir; never `config.worktree`, which can hold a remote. */
const OWN = ["HEAD", "index"];

/**
 * The only repository keys copied, each with the values git accepts: the ones that change how
 * objects and refs are stored. `extensions.worktreeConfig` stays out: it makes git read more config.
 */
const FORMAT = new Map<string, ReadonlyArray<string>>([
  ["core.repositoryformatversion", ["0", "1"]],
  ["extensions.objectformat", ["sha1", "sha256"]],
  ["extensions.compatobjectformat", ["sha1", "sha256"]],
  ["extensions.refstorage", ["files", "reftable"]],
]);

/** A generated common dir left by a session that started longer ago than this is removed. */
const STALE_MS = 24 * 60 * 60 * 1000;

/** What can name a remote, a header or a helper, in the common dir and the worktree's own. */
const SECRET_SHARED = ["config", "config.worktree", "modules", "logs", "hooks", "FETCH_HEAD"];

const SECRET_OWN = ["config.worktree", "logs"];

export interface ConfinedGit {
  /** Readable by the shell: the shared parts git needs, and this worktree's own HEAD and index. */
  readonly readable: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
}

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false
  );

const quote = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/** The format keys of `git config --list -z` output that hold a value git accepts. */
const formatKeys = (listed: string) =>
  listed.split("\0").flatMap((entry) => {
    const newline = entry.indexOf("\n");
    const key = (newline === -1 ? entry : entry.slice(0, newline)).toLowerCase();
    const value = newline === -1 ? "" : entry.slice(newline + 1).toLowerCase();

    return FORMAT.get(key)?.includes(value) === true ? [[key, value] as const] : [];
  });

/**
 * The config git reads in the shell, as a file: the repository's format keys (from
 * `git config --list -z`), the checkout as the work tree, and nothing that names another file.
 */
export const sanitizedConfig = (listed: string, worktree: string): string => {
  // Without these git looks for its ignore and attributes files in home, which the shell can't read.
  const sections = new Map<string, Array<string>>([
    [
      "core",
      [
        "\tbare = false",
        `\tworktree = ${quote(worktree)}`,
        '\texcludesFile = "/dev/null"',
        '\tattributesFile = "/dev/null"',
      ],
    ],
  ]);

  for (const [key, value] of new Map(formatKeys(listed))) {
    const dot = key.indexOf(".");
    const section = key.slice(0, dot);
    sections.set(section, [...(sections.get(section) ?? []), `\t${key.slice(dot + 1)} = ${value}`]);
  }

  return [...sections].map(([section, lines]) => `[${section}]\n${lines.join("\n")}\n`).join("");
};

/** Polaris's dir for generated common dirs, created if missing; refused unless only we can write it. */
const ownedRoot = async () => {
  const root = paths().confinedGit;
  await mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await lstat(root);
  const uid = process.getuid?.();

  if (!stat.isDirectory() || (uid !== undefined && stat.uid !== uid) || (stat.mode & 0o077) !== 0)
    throw new Error(
      `Polaris can't keep the reviewer's git config in ${root}: others can write it.`
    );

  return realpath(root);
};

/** Removes generated common dirs older than `STALE_MS`; one that can't be read is left alone. */
const pruneStale = async (root: string) => {
  const names = await readdir(root).catch(() => []);
  const cutoff = Date.now() - STALE_MS;

  await Promise.all(
    names.map(async (name) => {
      const stat = await lstat(join(root, name)).catch(() => null);

      if (stat !== null && stat.mtimeMs < cutoff)
        await rm(join(root, name), { recursive: true, force: true });
    })
  );
};

/** A new common dir that only this call has written: the generated config and links to `SHARED`. */
const generate = async (common: string, worktree: string) => {
  const root = await ownedRoot();
  await pruneStale(root);

  const listed = await gitText(common, [
    "config",
    "--file",
    join(common, "config"),
    "--list",
    "-z",
  ]);

  // mkdtemp makes a directory no one else could have made first, with mode 0700.
  const dir = await mkdtemp(join(root, "c-"));
  const temporary = join(dir, "config.partial");
  await writeFile(temporary, sanitizedConfig(listed, worktree), { flag: "wx", mode: 0o600 });
  await rename(temporary, join(dir, "config"));

  const present = await Promise.all(SHARED.map((name) => exists(join(common, name))));
  const kept = SHARED.filter((_, index) => present[index]);
  await Promise.all(kept.map((name) => symlink(join(common, name), join(dir, name))));

  return { dir, shared: kept.map((name) => join(common, name)) };
};

/**
 * Git for `worktree`, a checkout whose git dir (`gitDir`) lives in `common`, outside it. Only a
 * linked worktree gets one: anything else gets no git at all, so `null`. Rejects if the config
 * can't be generated, so the Reviewer doesn't start.
 */
export const confinedGit = async (
  common: string,
  gitDir: string,
  worktree: string
): Promise<ConfinedGit | null> => {
  if (gitDir === common || !isWithin(common, gitDir)) return null;

  // Windows has no sandbox for a shell to run git in (the Reviewer only reads), nor POSIX modes.
  if (process.platform === "win32") return null;
  const { dir, shared } = await generate(common, worktree);

  return {
    readable: [...shared, ...OWN.map((name) => join(gitDir, name)), dir],
    env: {
      GIT_COMMON_DIR: dir,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_COUNT: "0",
    },
  };
};

/**
 * The git dirs' paths a sandbox must keep closed even when it opens the whole repository, as
 * Claude Code's Linux sandbox does for a worktree: credentials and other worktrees.
 */
export const closedGitPaths = async (common: string, gitDir: string): Promise<Array<string>> => {
  const worktrees = join(common, "worktrees");
  const others = await readdir(worktrees).catch(() => []);

  const candidates = [
    ...SECRET_SHARED.map((name) => join(common, name)),
    ...SECRET_OWN.map((name) => join(gitDir, name)),
    ...others.map((name) => join(worktrees, name)).filter((path) => path !== gitDir),
  ];

  const present = await Promise.all(candidates.map(exists));

  return candidates.filter((_, index) => present[index]);
};
