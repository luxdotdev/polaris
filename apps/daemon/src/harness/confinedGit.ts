/**
 * The confined shell's git in a linked worktree: it reads the repository's objects and refs
 * but never its `config` (remote URLs and headers can carry tokens) nor other worktrees' data.
 * Git reads a sanitized copy instead, through `GIT_COMMON_DIR`. See ADR 0055.
 */
import { lstat, mkdir, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isWithin } from "../files/fs.ts";
import { gitText } from "../git/git.ts";

/** What git needs from the common dir to read history; `config`, hooks and logs stay out. */
const SHARED = ["objects", "refs", "packed-refs", "HEAD", "reftable", "shallow", "info"];

/** The repository settings git needs to read it correctly; nothing that names a remote or a secret. */
const KEPT_KEY =
  /^(core\.(repositoryformatversion|filemode|ignorecase|precomposeunicode|symlinks|autocrlf|eol|quotepath)|extensions\.[a-z0-9]+)$/;

export const SANITIZED_DIR = "polaris-common";

export interface ConfinedGit {
  /** Readable by the shell: the shared parts git needs, and this worktree's own git dir. */
  readonly readable: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
}

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false
  );

const quote = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/** `git config --list -z` output, reduced to `KEPT_KEY`, as a config file. */
export const sanitizedConfig = (listed: string): string => {
  const sections = new Map<string, Array<string>>();

  for (const entry of listed.split("\0")) {
    const newline = entry.indexOf("\n");
    const key = newline === -1 ? entry : entry.slice(0, newline);
    const value = newline === -1 ? "true" : entry.slice(newline + 1);

    if (!KEPT_KEY.test(key) || value.includes("\n")) continue;
    const dot = key.indexOf(".");
    const section = key.slice(0, dot);
    sections.set(section, [
      ...(sections.get(section) ?? []),
      `\t${key.slice(dot + 1)} = ${quote(value)}`,
    ]);
  }

  return [...sections].map(([section, lines]) => `[${section}]\n${lines.join("\n")}\n`).join("");
};

const linkTo = async (target: string, path: string) => {
  if ((await readlink(path).catch(() => null)) === target) return;
  await rm(path, { force: true, recursive: true });
  // Another session on this checkout may have made the same link first.
  await symlink(target, path).catch(() => undefined);

  if ((await readlink(path).catch(() => null)) !== target)
    throw new Error(`Polaris couldn't link ${path} to ${target}`);
};

const writeSanitized = async (common: string, dir: string) => {
  const listed = await gitText(common, [
    "config",
    "--file",
    join(common, "config"),
    "--list",
    "-z",
  ]).catch(() => "");

  await mkdir(dir, { recursive: true });
  const temporary = join(dir, `config.${process.pid}.${crypto.randomUUID()}`);
  await writeFile(temporary, sanitizedConfig(listed));
  await rename(temporary, join(dir, "config"));
  const present = await Promise.all(SHARED.map((name) => exists(join(common, name))));
  const kept = SHARED.filter((_, index) => present[index]);
  await Promise.all(kept.map((name) => linkTo(join(common, name), join(dir, name))));

  return kept.map((name) => join(common, name));
};

/**
 * Git for a checkout whose git dir (`gitDir`) lives in `common`, outside it. Only a linked
 * worktree gets one: anything else (a separate git dir) gets no git at all, so `null`.
 */
export const confinedGit = async (common: string, gitDir: string): Promise<ConfinedGit | null> => {
  if (gitDir === common || !isWithin(common, gitDir)) return null;
  const dir = join(gitDir, SANITIZED_DIR);

  return writeSanitized(common, dir).then(
    (shared) => ({ readable: [...shared, gitDir], env: { GIT_COMMON_DIR: dir } }),
    () => null
  );
};
