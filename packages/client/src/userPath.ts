/**
 * The PATH the user's own terminal has. launchd, systemd and the Dock start processes with a bare
 * PATH, so the Daemon and the Desktop App ask the user's interactive login shell (where Homebrew,
 * nvm and friends set PATH) once, and merge that with their own and a few well-known directories.
 * On macOS the bare PATH finds Apple's `/usr/bin/ssh`, which can't use security keys.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { type ChildProcessApi, childProcesses } from "./process/node.ts";

const START = "__POLARIS_PATH__";

const END = "__POLARIS_END__";

/** Printed by the shell; markers, because interactive rc files may print too. */
const SCRIPT = `printf '\\n${START}%s${END}\\n' "$PATH"`;

/** The login shell and its arguments, or null when there is no shell to ask. */
export const loginShellArgv = (
  env: Readonly<Record<string, string | undefined>>
): readonly [string, ReadonlyArray<string>] | null => {
  const shell = env.SHELL;

  if (shell === undefined || shell === "" || !existsSync(shell)) return null;

  return [shell, ["-i", "-l", "-c", SCRIPT]];
};

/** The PATH between the markers, or null. */
export const parseMarkedPath = (stdout: string): string | null => {
  const start = stdout.lastIndexOf(START);
  const end = stdout.indexOf(END, start);

  if (start === -1 || end === -1) return null;
  const path = stdout.slice(start + START.length, end).trim();

  return path === "" ? null : path;
};

/** Every directory once, in first-seen order; empty entries dropped. Lists split on `separator`. */
export const mergePathsWith = (
  separator: string,
  ...paths: ReadonlyArray<string | null | undefined>
): string => {
  const seen = new Set<string>();

  for (const path of paths) {
    for (const dir of (path ?? "").split(separator)) {
      if (dir !== "") seen.add(dir);
    }
  }

  return [...seen].join(separator);
};

/** `mergePathsWith` this platform's PATH separator: `;` on Windows, where `:` follows a drive letter. */
export const mergePaths = (...paths: ReadonlyArray<string | null | undefined>): string =>
  mergePathsWith(delimiter, ...paths);

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
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
  readonly processes?: ChildProcessApi;
}

/** The login shell's PATH without blocking; null when there is no shell or it misbehaves. */
export const loginShellPathAsync = ({
  env,
  timeoutMs = 3000,
  processes = childProcesses,
}: UserPathInput): Promise<string | null> => {
  const argv = loginShellArgv(env);

  if (argv === null) return Promise.resolve(null);

  return new Promise((resolve) => {
    const child = processes.spawn({
      file: argv[0],
      args: argv[1],
      env: { ...env, TERM: "dumb" },
      stdio: ["ignore", "pipe", "ignore"],
    });

    let stdout = "";

    // The shell's own children may hold stdout open past its death, so `close` can't time it.
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      child.stdout?.destroy();
      resolve(null);
    }, timeoutMs);

    const settle = (path: string | null) => {
      clearTimeout(timer);
      resolve(path);
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.once("error", () => settle(null));
    child.once("close", () => settle(parseMarkedPath(stdout)));
  });
};

/**
 * The login shell's PATH first (what the user sees in a terminal), then the process's own, then
 * the well-known directories. `POLARIS_USER_PATH=off` keeps the given PATH (tests, benchmarks).
 */
export const userPathAsync = async (input: UserPathInput): Promise<string> => {
  const { env } = input;

  if (env.POLARIS_USER_PATH === "off") return env.PATH ?? "";

  return mergePaths(
    await loginShellPathAsync(input),
    env.PATH,
    wellKnownDirs(env.HOME ?? homedir()).join(delimiter)
  );
};
