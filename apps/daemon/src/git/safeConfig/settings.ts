/** What an automatic git call is given: fixed settings, overrides for the repository's own, flags. */

/**
 * `"safe"`: nothing a repository's config names runs. `"trusted-fetch"`: a Review fetch in a
 * Workspace the user trusts on this Host, whose own ssh command, git proxy and credential helpers run.
 */
export type SafeMode = "safe" | "trusted-fetch";

/**
 * Windows: `NUL` is relative (a checkout's `NUL\pre-commit` is found) and `/dev/null` maps into
 * Git's install, so the running executable stands in: absolute, always present, never a directory.
 */
export function noHooksPath(os: string, execPath: string): string {
  return os === "win32" ? execPath : "/dev/null";
}

/**
 * A hooks "directory" that is a file, so it can hold no hook. Absolute on purpose: git resolves a
 * relative one against the working tree. Windows has no `/dev/null` (see `noHooksPath`).
 */
export const NO_HOOKS_PATH = noHooksPath(process.platform, process.execPath);

/** Settings that run commands, turned off whatever any config says. */
export const FIXED: ReadonlyArray<readonly [string, string]> = [
  ["core.hooksPath", NO_HOOKS_PATH],
  ["core.fsmonitor", "false"],
  ["log.showSignature", "false"],
  ["protocol.ext.allow", "never"],
  ["core.pager", "cat"],
  ["core.editor", "false"],
  ["sequence.editor", "false"],
  ["core.askPass", ""],
  ["core.alternateRefsCommand", "true"],
  ["gpg.program", "false"],
  ["gpg.openpgp.program", "false"],
  ["gpg.x509.program", "false"],
  ["gpg.ssh.program", "false"],
  ["gpg.ssh.defaultKeyCommand", "false"],
  ["gc.auto", "0"],
  ["maintenance.auto", "false"],
  // Never into a submodule: its own config and hooks are never read.
  ["submodule.recurse", "false"],
  ["fetch.recurseSubmodules", "false"],
  ["diff.ignoreSubmodules", "dirty"],
  ["diff.submodule", "short"],
  ["status.submoduleSummary", "false"],
];

/** Drivers a repository's own config can name; an empty command turns each one off. */
const DRIVER = /^(filter\..+\.(clean|smudge|process)|merge\..+\.driver)$/;

/** `git lfs install --local` writes these; they run the user's own git-lfs. */
const KNOWN_DRIVERS = new Set([
  "git-lfs clean -- %f",
  "git-lfs smudge -- %f",
  "git-lfs filter-process",
]);

const CREDENTIAL_HELPER = /^credential\.(.+\.)?helper$/;

export const REPOSITORY_SCOPES: ReadonlySet<string> = new Set(["local", "worktree"]);

export interface Entry {
  readonly scope: string;
  /** Where git read it: `file:<path>`, `command line:`, … */
  readonly origin: string;
  /** As git prints it: section and name lowercased, a subsection as written. */
  readonly key: string;
  readonly value: string;
}

/** Parses `git config --list --show-scope --show-origin -z`: `scope NUL origin NUL key LF value NUL`. */
export const parseListing = (listing: string): ReadonlyArray<Entry> => {
  const fields = listing.split("\0");
  const entries: Array<Entry> = [];

  for (let i = 0; i + 2 < fields.length; i += 3) {
    const entry = fields[i + 2] ?? "";
    const newline = entry.indexOf("\n");

    entries.push({
      scope: fields[i] ?? "",
      origin: fields[i + 1] ?? "",
      key: newline === -1 ? entry : entry.slice(0, newline),
      value: newline === -1 ? "" : entry.slice(newline + 1),
    });
  }

  return entries;
};

export type Pair = readonly [string, string];

const driverOverride = ({ key, value }: Entry): ReadonlyArray<Pair> =>
  DRIVER.test(key) && !KNOWN_DRIVERS.has(value) ? [[key, ""]] : [];

/** The repository's ssh command replaced by the Host's (or plain `ssh`). */
const sshOverride = (entries: ReadonlyArray<Entry>): ReadonlyArray<Pair> => {
  const ssh = entries.filter((e) => e.key === "core.sshcommand");

  if (!ssh.some((e) => REPOSITORY_SCOPES.has(e.scope))) return [];
  const host = ssh.filter((e) => !REPOSITORY_SCOPES.has(e.scope)).at(-1);

  return [["core.sshCommand", host?.value ?? "ssh"]];
};

/** An empty helper resets git's list; then the Host's own helpers again, in order. */
const credentialOverride = (entries: ReadonlyArray<Entry>): ReadonlyArray<Pair> => {
  const helpers = entries.filter((e) => CREDENTIAL_HELPER.test(e.key));

  if (!helpers.some((e) => REPOSITORY_SCOPES.has(e.scope))) return [];
  const host = helpers.filter((e) => !REPOSITORY_SCOPES.has(e.scope));

  return [["credential.helper", ""], ...host.map((e): Pair => [e.key, e.value])];
};

/** What overrides the commands the repository's own (local or worktree) config names. */
export const repositoryOverrides = (
  entries: ReadonlyArray<Entry>,
  mode: SafeMode
): ReadonlyArray<Pair> => {
  const drivers = entries.filter((e) => REPOSITORY_SCOPES.has(e.scope)).flatMap(driverOverride);

  if (mode === "trusted-fetch") return drivers;

  return [...drivers, ...sshOverride(entries), ...credentialOverride(entries)];
};

/**
 * The environment that overrides what config can't: the first `core.gitProxy` git
 * reads wins, so a repository's is only beaten by an empty `GIT_PROXY_COMMAND` (no proxy).
 */
export const repositoryEnv = (
  entries: ReadonlyArray<Entry>,
  mode: SafeMode,
  base: Readonly<Record<string, string | undefined>>
): Record<string, string> => {
  const proxied = entries.some((e) => e.key === "core.gitproxy" && REPOSITORY_SCOPES.has(e.scope));

  return mode === "safe" && proxied && base.GIT_PROXY_COMMAND === undefined
    ? { GIT_PROXY_COMMAND: "" }
    : {};
};

export const configEnv = (
  pairs: ReadonlyArray<Pair>,
  base: Readonly<Record<string, string | undefined>>
) => {
  const start = Number.parseInt(base.GIT_CONFIG_COUNT ?? "0", 10);
  const offset = Number.isNaN(start) || start < 0 ? 0 : start;

  return {
    GIT_CONFIG_COUNT: String(offset + pairs.length),
    ...Object.fromEntries(
      pairs.flatMap(([key, value], i) => [
        [`GIT_CONFIG_KEY_${offset + i}`, key],
        [`GIT_CONFIG_VALUE_${offset + i}`, value],
      ])
    ),
  };
};

const WITH_VALUE = new Set(["-c", "-C", "--git-dir", "--work-tree", "--namespace"]);

/** Options before the subcommand, e.g. `-C`, `--git-dir`, `-c`: they decide which repository git reads. */
export const globalOptions = (args: ReadonlyArray<string>): ReadonlyArray<string> => {
  let i = 0;

  while (i < args.length && args[i]?.startsWith("-") === true) {
    i += WITH_VALUE.has(args[i] ?? "") ? 2 : 1;
  }

  return args.slice(0, i);
};

/** The Daemon's own `-c` values that name no command, include or file, and move no discovery. */
const INERT_VALUES = new Set([
  "core.splitIndex=false",
  "index.skipHash=true",
  `core.hooksPath=${NO_HOOKS_PATH}`,
  "core.quotePath=true",
]);

/**
 * The global options to list a call's config with: an inert `-c` only adds a command-line
 * entry no override reads, so `-c core.splitIndex=false status` shares `status`'s listing.
 */
export const listingOptions = (options: ReadonlyArray<string>): ReadonlyArray<string> => {
  const kept: Array<string> = [];

  for (let i = 0; i < options.length;) {
    const width = WITH_VALUE.has(options[i] ?? "") ? 2 : 1;
    const inert = options[i] === "-c" && INERT_VALUES.has(options[i + 1] ?? "");

    if (!inert) kept.push(...options.slice(i, i + width));
    i += width;
  }

  return kept;
};

/** Commands that diff: an external diff or textconv driver would otherwise run. */
const DIFFING = new Set(["diff", "log", "show"]);

/** Commands that look at a submodule's work tree unless told not to. */
const SUBMODULE_DIRTY = new Set(["status", "diff", "diff-files", "diff-index"]);

/** A local remote's `remote.<name>.uploadpack` would run on this Host; only a flag overrides it. */
const FETCHING = new Set(["fetch", "ls-remote"]);

/** `args` with the flags that keep a command off drivers, submodules and a remote's own upload-pack. */
export const safeArgs = (args: ReadonlyArray<string>): ReadonlyArray<string> => {
  const i = globalOptions(args).length;
  const command = args[i];

  if (command === undefined) return args;

  const flags = [
    ...(DIFFING.has(command) ? ["--no-ext-diff", "--no-textconv"] : []),
    ...(SUBMODULE_DIRTY.has(command) ? ["--ignore-submodules=dirty"] : []),
    ...(FETCHING.has(command) ? ["--upload-pack=git-upload-pack"] : []),
  ];

  return flags.length === 0 ? args : [...args.slice(0, i + 1), ...flags, ...args.slice(i + 1)];
};
