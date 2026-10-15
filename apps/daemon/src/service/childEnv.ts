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
  // Windows needs these to start a process at all.
  "SystemRoot",
  "SYSTEMROOT",
  "ComSpec",
  "COMSPEC",
  "PATHEXT",
  "WINDIR",
  "USERPROFILE",
]);

const LOCALE = /^LC_[A-Z]+$/;

/**
 * The environment of a child that runs a repository's own code (a Review Run): an allowlist,
 * so provider keys, tokens, `SSH_AUTH_SOCK` and Polaris's own variables never reach it.
 * See docs/adr/0054-repository-code-gets-an-allowlisted-environment.md.
 */
export const repositoryEnv = (source: Env = process.env, extra: Env = {}) => {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(source))
    if (value !== undefined && (REPOSITORY_KEYS.has(key) || LOCALE.test(key))) env[key] = value;

  for (const [key, value] of Object.entries(extra)) if (value !== undefined) env[key] = value;

  return env;
};
