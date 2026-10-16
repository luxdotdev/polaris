/**
 * The PATH the user's own terminal has. launchd and systemd start the Daemon
 * with a bare PATH, and so does `ssh host cmd`, which runs `polaris install`;
 * Harnesses installed with their own installers (`~/.local/bin/claude`), nvm
 * (`codex`) or bun then look missing. `polaris serve` asks the user's shell
 * once, as an interactive login shell (where nvm and friends set PATH), and
 * merges that with its own PATH and a few well-known user bin directories.
 */
import { childEnv } from "./childEnv.ts";
import {
  loginShellArgv,
  mergePaths,
  parseMarkedPath,
  type UserPathInput,
  wellKnownDirs,
} from "@polaris/client/userPath";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

export { mergePaths, parseMarkedPath } from "@polaris/client/userPath";

/** The user's interactive login shell's PATH; null when there is no shell or it misbehaves. */
export const loginShellPath = ({ env, timeoutMs = 3000 }: UserPathInput): string | null => {
  const argv = loginShellArgv(env);

  if (argv === null) return null;

  const result = spawnSync(argv[0], argv[1], {
    env: childEnv({ ...env, TERM: "dumb" }),
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

/**
 * `Bun.which` on the PATH this process has now. A bare `Bun.which(name)` reads
 * the PATH the process started with and misses what `runServe` merged in.
 */
export const which = (name: string): string | null =>
  Bun.which(name, { PATH: process.env.PATH ?? "" });
