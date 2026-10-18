import { posix, win32 } from "node:path";

type Env = Readonly<Record<string, string | undefined>>;

/** Explicit environment for children; Bun's default retains the original hand-off envelope. */
export const childEnv = (source: Env = process.env) => {
  const { POLARIS_HANDOFF: _handoff, ...env } = source;

  return env;
};

/** What a shell and the usual toolchains need to start; nothing that grants access. */
const REPOSITORY_KEYS: ReadonlySet<string> = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LANGUAGE",
  "TZ",
  "TMPDIR",
  "TEMP",
  "TMP",
  "TERM",
  "COLORTERM",
]);

/** What Windows programs need to start and find the user's folders (lowercase: its names keep any case). */
const WINDOWS_KEYS: ReadonlySet<string> = new Set(
  [
    // Windows' own casing is `Path`: REPOSITORY_KEYS' `PATH` alone dropped it.
    "PATH",
    "SystemRoot",
    "SystemDrive",
    "windir",
    "ComSpec",
    "PATHEXT",
    "OS",
    "USERPROFILE",
    "USERNAME",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "ProgramData",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "ProgramW6432",
    "CommonProgramFiles",
    "CommonProgramFiles(x86)",
    "CommonProgramW6432",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
  ].map((key) => key.toLowerCase())
);

/** On Windows, a variable a program needs to run at all; none grants access. */
export const isWindowsBaseKey = (key: string, os: string = process.platform): boolean =>
  os === "win32" && WINDOWS_KEYS.has(key.toLowerCase());

const LOCALE = /^LC_[A-Z]+$/;

const isPathKey = (key: string, os: string) =>
  os === "win32" ? key.toLowerCase() === "path" : key === "PATH";

/** `PATH`'s absolute entries: a shell reads an empty or relative one as the cwd, a repository. */
export const absolutePath = (path: string, os: string = process.platform): string => {
  const [delimiter, absolute] = os === "win32" ? [";", win32.isAbsolute] : [":", posix.isAbsolute];

  return path
    .split(delimiter)
    .filter((entry) => absolute(entry.trim().replace(/^"(.*)"$/, "$1")))
    .join(delimiter);
};

/**
 * What a child in a repository gets on top: only `PATH`'s absolute entries, and on Windows
 * `NoDefaultCurrentDirectoryInExePath`, so cmd.exe never runs a bare name from its cwd first.
 * Bun.spawn itself ignores that variable (ADR 0070).
 */
export const repositoryChild = (
  env: Record<string, string>,
  os: string = process.platform
): Record<string, string> => {
  const child: Record<string, string> = {};

  for (const [key, value] of Object.entries(env))
    child[key] = isPathKey(key, os) ? absolutePath(value, os) : value;

  return os === "win32" ? { ...child, NoDefaultCurrentDirectoryInExePath: "1" } : child;
};

/**
 * The environment of a child that runs a repository's own code (a Review Run): an allowlist,
 * so provider keys, tokens, `SSH_AUTH_SOCK` and Polaris's own variables never reach it.
 * See docs/adr/0054-repository-code-gets-an-allowlisted-environment.md.
 */
export const repositoryEnv = (source: Env = process.env, extra: Env = {}) => {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(source))
    if (
      value !== undefined &&
      (REPOSITORY_KEYS.has(key) || LOCALE.test(key) || isWindowsBaseKey(key))
    )
      env[key] = value;

  for (const [key, value] of Object.entries(extra)) if (value !== undefined) env[key] = value;

  return repositoryChild(env);
};
