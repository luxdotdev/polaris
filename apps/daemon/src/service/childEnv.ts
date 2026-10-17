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

  return env;
};
