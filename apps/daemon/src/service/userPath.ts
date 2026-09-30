/**
 * The PATH the user's own terminal has. launchd and systemd start the Daemon
 * with a bare PATH, and so does `ssh host cmd`, which runs `polaris install`;
 * Harnesses installed with their own installers (`~/.local/bin/claude`), nvm
 * (`codex`) or bun then look missing. `polaris serve` asks the user's shell
 * once, as an interactive login shell (where nvm and friends set PATH), and
 * merges that with its own PATH and a few well-known user bin directories.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const START = "__POLARIS_PATH__";

const END = "__POLARIS_END__";

/** Printed by the shell; markers, because interactive rc files may print too. */
const SCRIPT = `printf '\\n${START}%s${END}\\n' "$PATH"`;

/** The PATH between the markers, or null. */
export const parseMarkedPath = (stdout: string): string | null => {
  const start = stdout.lastIndexOf(START);
  const end = stdout.indexOf(END, start);

  if (start === -1 || end === -1) return null;
  const path = stdout.slice(start + START.length, end).trim();

  return path === "" ? null : path;
};

/** Every directory once, in first-seen order; empty entries dropped. */
export const mergePaths = (...paths: ReadonlyArray<string | null | undefined>): string => {
  const seen = new Set<string>();

  for (const path of paths) {
    for (const dir of (path ?? "").split(":")) {
      if (dir !== "") seen.add(dir);
    }
  }

  return [...seen].join(":");
};

/** Where per-user installers put binaries; added only when they exist. */
export const wellKnownDirs = (home: string): ReadonlyArray<string> =>
  [
    join(home, ".local", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".cargo", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ].filter((dir) => existsSync(dir));

export interface UserPathInput {
  readonly env: Record<string, string | undefined>;
  readonly timeoutMs?: number;
}

/** The user's interactive login shell's PATH; null when there is no shell or it misbehaves. */
export const loginShellPath = ({ env, timeoutMs = 3000 }: UserPathInput): string | null => {
  const shell = env.SHELL;

  if (shell === undefined || shell === "" || !existsSync(shell)) return null;

  const result = spawnSync(shell, ["-i", "-l", "-c", SCRIPT], {
    env: { ...env, TERM: "dumb" },
    stdio: ["ignore", "pipe", "ignore"],
    timeout: timeoutMs,
    encoding: "utf8",
  });

  return result.error === undefined ? parseMarkedPath(result.stdout ?? "") : null;
};

/**
 * The PATH `polaris serve` runs with: the login shell's first (what the user
 * sees in a terminal), then the service's own, then the well-known directories.
 * `POLARIS_USER_PATH=off` keeps the given PATH (tests, benchmarks).
 */
export const userPath = (input: UserPathInput): string => {
  const { env } = input;

  if (env.POLARIS_USER_PATH === "off") return env.PATH ?? "";

  return mergePaths(
    loginShellPath(input),
    env.PATH,
    wellKnownDirs(env.HOME ?? homedir()).join(":")
  );
};
