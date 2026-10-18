/**
 * The shell a terminal opened without a command runs: the Host user's login
 * shell on macOS and Linux, PowerShell 7, then Windows PowerShell, then cmd on Windows.
 */
import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import { findExecutable, hasDirectory } from "../platform/executable.ts";
import { envValue } from "../platform/processes.ts";
import { which } from "../service/userPath.ts";

/** Where `loginShell` looks, in order; the readers may throw. */
export interface ShellSources {
  readonly userShell: () => string | null | undefined;
  readonly passwd: () => string;
  readonly uid: number | undefined;
  readonly envShell: string | undefined;
}

const hostShellSources = (): ShellSources => ({
  userShell: () => userInfo().shell,
  passwd: () => readFileSync("/etc/passwd", "utf8"),
  uid: process.getuid?.(),
  envShell: process.env.SHELL,
});

/** The Host user's login shell: the passwd entry first (launchd/systemd may not set SHELL). */
export const loginShell = (sources: ShellSources = hostShellSources()): string => {
  try {
    // Bun reports "unknown" for fields it could not read (seen in Alpine and Debian containers).
    const shell = sources.userShell();

    if (shell?.startsWith("/")) return shell;
  } catch {
    // No passwd entry (some containers).
  }

  try {
    const entry = sources
      .passwd()
      .split("\n")
      .map((line) => line.split(":"))
      .find((fields) => fields[2] === String(sources.uid));

    if (entry?.[6]?.startsWith("/")) return entry[6];
  } catch {}

  return sources.envShell || "/bin/sh";
};

/** What `windowsShell` looks for: a program on PATH, and `ComSpec`. */
export interface WindowsShellSources {
  readonly find: (name: string) => string | null;
  readonly comSpec: string | undefined;
}

/**
 * PowerShell 7 (`pwsh`), else Windows PowerShell, else cmd. Windows has no login
 * shell to read and `SHELL` is only what OpenSSH sets for its own sessions.
 */
export const windowsShell = (sources: WindowsShellSources): Array<string> => {
  for (const name of ["pwsh", "powershell"]) {
    const found = sources.find(name);

    if (found !== null) return [found, "-NoLogo"];
  }

  return [sources.comSpec ?? sources.find("cmd") ?? "cmd.exe"];
};

/** The argv of a terminal opened without a command, on this Host. */
export const defaultShellArgv = (): Array<string> =>
  process.platform === "win32"
    ? windowsShell({ find: which, comSpec: envValue(process.env, "ComSpec") })
    : [loginShell(), "-l"];

/**
 * argv[0] as a terminal in `cwd` starts it: a bare name off the child's PATH, never `cwd`
 * (Windows looks there first: ADR 0070); a relative path in `cwd`, as a shell would.
 */
export const programIn = (
  cwd: string,
  program: string,
  env: Readonly<Record<string, string | undefined>>
): string | null => (hasDirectory(program) ? resolve(cwd, program) : findExecutable(program, env));
