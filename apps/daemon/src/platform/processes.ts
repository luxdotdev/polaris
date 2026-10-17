/**
 * Processes the same way on every Host. POSIX has process groups and signals;
 * Windows has neither, so a tree is ended with `taskkill /T /F` and a shell
 * command runs under `cmd.exe`. See docs/adr/0060-windows-process-trees.md.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { childEnv } from "../service/childEnv.ts";

type Env = Readonly<Record<string, string | undefined>>;

/** The value of `key` in `env`, whatever its case: Windows keeps `Path`, `ComSpec`, `SystemRoot`. */
export const envValue = (env: Env, key: string): string | undefined => {
  if (env[key] !== undefined) return env[key];
  const lower = key.toLowerCase();

  for (const [name, value] of Object.entries(env)) if (name.toLowerCase() === lower) return value;

  return undefined;
};

/**
 * Renames Windows' `Path` to `PATH` in `process.env`, so `{ ...process.env }.PATH`
 * reads it, as every caller expects. A no-op elsewhere.
 */
export const normalizeWindowsEnv = (os: string = process.platform, env = process.env): void => {
  if (os !== "win32" || Object.keys(env).includes("PATH")) return;
  const value = envValue(env, "PATH");

  if (value === undefined) return;

  for (const name of Object.keys(env)) if (name.toLowerCase() === "path") delete env[name];
  env.PATH = value;
};

/**
 * Whether a child should lead its own process group, so `killTree` reaches what it
 * started. Windows has none: `detached` there means another console instead.
 */
export const ownProcessGroup = (os: string = process.platform): boolean => os !== "win32";

/** True while `pid` exists and this user may signal it; `kill(pid, 0)` works on Windows too. */
export const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
};

const systemRoot = (env: Env) => envValue(env, "SystemRoot") ?? "C:\\Windows";

/** A Windows tool by its full path, so a planted `netstat.exe` on PATH is never the one run. */
export const system32 = (exe: string, env: Env = process.env): string =>
  join(systemRoot(env), "System32", exe);

/** `taskkill` by its full path, so a PATH entry can't stand in for it. */
export const taskkillArgv = (pid: number, env: Env = process.env): Array<string> => [
  system32("taskkill.exe", env),
  "/T",
  "/F",
  "/PID",
  String(pid),
];

const signalGroup = (pid: number, signal: NodeJS.Signals) => {
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone.
  }
};

/**
 * Ends `pid` and everything it started: `signal` to its process group on POSIX
 * (it must have been spawned with `ownProcessGroup()`), `taskkill /T /F` on
 * Windows, which can't ask politely. Resolves once taskkill is done.
 */
export const killTree = async (pid: number, signal: NodeJS.Signals = "SIGTERM"): Promise<void> => {
  if (process.platform !== "win32") return signalGroup(pid, signal);

  try {
    await Bun.spawn(taskkillArgv(pid), { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
      .exited;
  } catch {
    // taskkill missing: nothing else can end a tree here.
  }
};

/** `killTree` for finalizers that can't wait: blocks for taskkill on Windows (~200 ms). */
export const killTreeSync = (pid: number, signal: NodeJS.Signals = "SIGTERM"): void => {
  if (process.platform !== "win32") return signalGroup(pid, signal);

  try {
    Bun.spawnSync(taskkillArgv(pid), { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  } catch {}
};

/**
 * Stops a child this Daemon spawned: `signal` on POSIX; on Windows its tree, as a
 * `.cmd` shim's cmd.exe would otherwise leave node and the real program running.
 */
export const stopChild = (
  child: { readonly pid: number; readonly kill: (signal?: NodeJS.Signals) => void },
  signal?: NodeJS.Signals
): void => {
  if (process.platform === "win32") void killTree(child.pid);
  else child.kill(signal);
};

/** The argv that prints `pid`'s command line: `ps`, or on Windows its CIM record. */
export const commandLineArgv = (pid: number, os: string = process.platform): Array<string> =>
  os === "win32"
    ? [
        "powershell.exe",
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Math.trunc(pid)}').CommandLine`,
      ]
    : ["ps", "-o", "command=", "-p", String(pid)];

/** `pid`'s command line, or null when it's gone. Linux reads `/proc`; Windows takes ~300 ms. */
export const commandLineOf = (pid: number): string | null => {
  if (process.platform === "linux") {
    try {
      return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ").trim();
    } catch {
      return null;
    }
  }

  const result = Bun.spawnSync(commandLineArgv(pid), {
    env: childEnv(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });

  const text = result.stdout.toString().trim();

  return result.exitCode === 0 && text !== "" ? text : null;
};

/** How to run a shell command line: the argv, and whether Bun must pass it unquoted. */
export interface ShellCommand {
  readonly argv: Array<string>;
  /** Windows only: cmd.exe parses its own command line, so Bun mustn't quote it. */
  readonly windowsVerbatimArguments: boolean;
}

/**
 * `command` as `/bin/sh -c` runs it, or on Windows as `cmd.exe /d /s /c "…"`
 * (what npm runs scripts with): no AutoRun, and the outer quotes stripped.
 */
export const shellCommand = (
  command: string,
  os: string = process.platform,
  env: Env = process.env
): ShellCommand =>
  os === "win32"
    ? {
        argv: [
          envValue(env, "ComSpec") ?? join(systemRoot(env), "System32", "cmd.exe"),
          "/d",
          "/s",
          "/c",
          `"${command}"`,
        ],
        windowsVerbatimArguments: true,
      }
    : { argv: ["/bin/sh", "-c", command], windowsVerbatimArguments: false };
