/**
 * Where a read-only session (the Reviewer) may read: its checkout, a fixed read-only toolchain
 * and, in a linked worktree, what git needs; nothing else. Each Harness enforces it with its
 * own OS sandbox. See docs/adr/0055-the-reviewer-reads-only-its-checkout.md.
 */
import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { isWithin } from "../files/fs.ts";
import { gitText } from "../git/git.ts";
import { paths } from "../paths.ts";
import { confinedGit } from "./confinedGit.ts";

export interface ReadConfinement {
  /** The session's checkout, canonical: the only place its file tools may read. */
  readonly root: string;
  /** What a sandboxed shell may read besides `root`. */
  readonly shellRoots: ReadonlyArray<string>;
  /** Inside `root` or `shellRoots` but never readable: a git dir in the checkout, credential files. */
  readonly hidden: ReadonlyArray<string>;
  /** Set in the shell's environment: git reads no config that can hold credentials. */
  readonly shellEnv: Readonly<Record<string, string>>;
}

/** The user's and the system's git config can name credential helpers; the shell's git reads neither. */
const NO_HOST_GIT_CONFIG = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } as const;

/** System tool and library directories a shell needs to run git, grep and the like. */
export const TOOLCHAIN: ReadonlyArray<string> = [
  "/bin",
  "/sbin",
  "/usr",
  "/lib",
  "/lib32",
  "/lib64",
  "/libx32",
  "/dev",
  "/nix/store",
  "/opt/homebrew",
  "/System",
  "/private/var/select",
  // Where macOS records the Xcode licence; `/usr/bin/git` refuses to run without it.
  "/Library/Preferences/com.apple.dt.Xcode.plist",
];

/** On macOS `/usr/bin/git` finds the developer tools through this link, which passes through `/var`. */
const DEVELOPER_LINK = "/private/var/select/developer_dir";

/** Under home: what holds credentials, hidden wherever a readable root covers it. */
const CREDENTIALS = [
  ".ssh",
  ".netrc",
  ".git-credentials",
  ".config/git",
  ".config/gh",
  ".config/gcloud",
  ".aws",
  ".azure",
  ".kube",
  ".docker",
  ".gnupg",
  ".codex",
  ".claude",
  ".claude.json",
  ".npmrc",
  ".pypirc",
];

const canonical = (path: string) => realpath(path).catch(() => resolve(path));

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false
  );

/** The checkout's own git dir and the repository's common dir, canonical. */
const gitDirs = (root: string) =>
  gitText(root, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"]).then(
    async (output) => {
      const [gitDir, common] = output.split("\n");

      if (gitDir === undefined || common === undefined || gitDir === "" || common === "")
        return null;

      return { gitDir: await canonical(gitDir), common: await canonical(common) };
    },
    () => null
  );

/** Whether either path holds the other. */
const overlaps = (a: string, b: string) => isWithin(a, b) || isWithin(b, a);

const unique = (items: ReadonlyArray<string>) => [...new Set(items)];

/** macOS's active developer directory, named in the shell's `DEVELOPER_DIR` since `/var` is closed. */
const developerDir = () => realpath(DEVELOPER_LINK).catch(() => null);

/** What the developer tools read: the whole Xcode bundle when they live in one. */
const developerRoot = (developer: string) =>
  developer.match(/^(.+\.app)\/Contents\/Developer$/)?.[1] ?? developer;

/** The toolchain directories on this Host, never home, Polaris's state, or anything above or in them. */
const toolchain = async (closed: ReadonlyArray<string>, developer: string | null) => {
  const present = await Promise.all(
    TOOLCHAIN.map(async (dir) => ((await exists(dir)) ? canonical(dir) : null))
  );

  return unique(
    [...present, developer === null ? null : developerRoot(developer)].filter(
      (dir): dir is string => dir !== null && dir !== "/" && !closed.some((p) => overlaps(dir, p))
    )
  );
};

/** Credential paths under home and the Harnesses' own config dirs that a readable root covers. */
const credentialsWithin = async (
  readable: ReadonlyArray<string>,
  home: string,
  env: Readonly<Record<string, string | undefined>>
) => {
  const named = [env.CLAUDE_CONFIG_DIR, env.CODEX_HOME].filter((dir) => dir !== undefined);

  const candidates = await Promise.all(
    [...CREDENTIALS.map((name) => join(home, name)), ...named].map(canonical)
  );

  return candidates.filter((path) => readable.some((root) => isWithin(root, path)));
};

export const readConfinement = async (
  cwd: string,
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<ReadConfinement> => {
  const root = await canonical(cwd);
  const home = await canonical(homedir());
  const state = await canonical(paths().root);

  if (root === "/" || isWithin(root, home) || isWithin(root, state))
    throw new Error(`The reviewer can't be kept to ${root}: it holds your home directory.`);
  const dirs = await gitDirs(root);
  const inside = dirs !== null && isWithin(root, dirs.common);
  const git = dirs === null || inside ? null : await confinedGit(dirs.common, dirs.gitDir);
  const developer = await developerDir();
  const tools = await toolchain([home, state], developer);
  const shellRoots = unique([...(git?.readable ?? []), ...tools]);
  const ownGitDirs = inside ? unique([dirs.common, dirs.gitDir]) : [];

  const developerEnv =
    developer !== null && tools.includes(developerRoot(developer))
      ? [["DEVELOPER_DIR", developer] as const]
      : [];

  return {
    root,
    shellRoots,
    hidden: unique([...ownGitDirs, ...(await credentialsWithin([root, ...shellRoots], home, env))]),
    shellEnv: { ...NO_HOST_GIT_CONFIG, ...git?.env, ...Object.fromEntries(developerEnv) },
  };
};

/** The nearest existing ancestor's real path, with the rest appended: where `path` would land. */
const landing = async (path: string): Promise<string> => {
  if (await exists(path)) return realpath(path);
  const parent = dirname(path);

  return parent === path ? path : join(await landing(parent), basename(path));
};

/** Whether `input` (relative to `cwd`) stays inside `root`, both as written and once links resolve. */
export const confined = async (root: string, cwd: string, input: string): Promise<boolean> => {
  const lexical = resolve(cwd, input);

  if (!isWithin(root, lexical)) return false;

  return landing(lexical).then(
    (real) => isWithin(root, real),
    () => false
  );
};
