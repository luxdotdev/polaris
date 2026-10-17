/**
 * The shared Codex app-server on Windows. Codex refuses a Unix socket there ("not
 * private to the current user"), so it listens on loopback: on a port it binds
 * itself (`:0`), behind a capability token in a user-only file. The port is the
 * listener a process of the started tree holds, and before anything is sent to it
 * that listener must still be the recorded one. See docs/adr/0060-windows-process-trees.md.
 */
import { randomBytes } from "node:crypto";
import { closeSync, openSync, rmSync, writeFileSync } from "node:fs";
import { childEnv } from "../../service/childEnv.ts";
import { isRunning, killTree, system32 } from "../../platform/processes.ts";

export interface Listener {
  readonly port: number;
  readonly pid: number;
}

/**
 * The loopback listeners in `netstat -ano -p TCP` output. A listener is a row with no
 * foreign address (`0.0.0.0:0`), since the state column is localized.
 */
export const parseListeners = (netstat: string): ReadonlyArray<Listener> => {
  const listeners: Array<Listener> = [];

  for (const line of netstat.split(/\r?\n/)) {
    const [proto, local, foreign, , owner] = line.trim().split(/\s+/);
    const port = Number(/^127\.0\.0\.1:(\d+)$/.exec(local ?? "")?.[1]);
    const pid = Number(owner);

    if (proto === "TCP" && foreign === "0.0.0.0:0" && port > 0 && pid > 0)
      listeners.push({ port, pid });
  }

  return listeners;
};

/** True if `pid` is `root` or below it, in `pid parent` rows from the process table. */
export const isInTree = (table: string, root: number, pid: number): boolean => {
  const parentOf = new Map<number, number>();

  for (const line of table.split(/\r?\n/)) {
    const [child, parent] = line.trim().split(/\s+/).map(Number);

    if (child !== undefined && parent !== undefined && child > 0) parentOf.set(child, parent);
  }

  // Bounded: a reused pid can make the parent links loop.
  for (let at: number | undefined = pid, hops = 0; at !== undefined && hops < 64; hops++) {
    if (at === root) return true;
    at = parentOf.get(at);
  }

  return false;
};

/** Runs a System32 tool and returns its stdout, or null if it failed. */
const run = (argv: Array<string>): string | null => {
  const result = Bun.spawnSync(argv, { env: childEnv(), stdin: "ignore", stderr: "ignore" });

  return result.exitCode === 0 ? result.stdout.toString() : null;
};

const loopbackListeners = () =>
  parseListeners(run([system32("NETSTAT.EXE"), "-ano", "-p", "TCP"]) ?? "");

/** The pid listening on the loopback `port` right now, or null if nothing is. */
export const listenerOn = (port: number): number | null =>
  loopbackListeners().find((listener) => listener.port === port)?.pid ?? null;

const processTable = () =>
  run([
    system32("WindowsPowerShell\\v1.0\\powershell.exe"),
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }',
  ]) ?? "";

/** True while the recorded listener is alive and still the one on `listen`'s port. */
export const ownsListen = (listen: string, listenerPid: number): boolean => {
  const port = Number(new URL(listen).port);

  return isRunning(listenerPid) && listenerOn(port) === listenerPid;
};

export const windowsServerArgv = (options: {
  readonly codexPath: string;
  readonly tokenFile: string;
}): Array<string> => [
  options.codexPath,
  "app-server",
  "--listen",
  "ws://127.0.0.1:0",
  "--ws-auth",
  "capability-token",
  "--ws-token-file",
  options.tokenFile,
];

/** This user's SID from `whoami /user /fo csv /nh`: `"host\user","S-1-5-21-…"`. */
export const parseSid = (whoami: string): string | null =>
  /"(S-1-[0-9-]+)"/.exec(whoami)?.[1] ?? null;

/** Who may read the token: this user only, nothing inherited from a shared POLARIS_HOME. */
const restrictToUser = (file: string) => {
  const sid = parseSid(run([system32("whoami.exe"), "/user", "/fo", "csv", "/nh"]) ?? "");
  const argv = [system32("icacls.exe"), file, "/inheritance:r", "/grant:r", `*${sid}:F`];

  if (sid === null || run(argv) === null) throw new Error(`could not make ${file} private`);
};

/** A fresh token, so a client of a replaced server can't reach the new one; private before it is written. */
export const writeToken = (tokenFile: string): void => {
  rmSync(tokenFile, { force: true });
  writeFileSync(tokenFile, "", { mode: 0o600 });
  restrictToUser(tokenFile);
  writeFileSync(tokenFile, randomBytes(32).toString("hex"));
};

export interface WindowsLaunched {
  readonly pid: number;
  readonly listen: string;
  /** The process that owns the port (codex.exe, below the `.cmd` shim's cmd.exe and node). */
  readonly listenerPid: number;
}

/**
 * Starts the server detached and waits until it is bound. A detached child's output is
 * lost on Windows, so `logFile` only gets what codex writes there itself.
 */
export const windowsLaunch = async (options: {
  readonly codexPath: string;
  readonly tokenFile: string;
  readonly logFile: string;
  readonly timeoutMs: number;
}): Promise<WindowsLaunched> => {
  writeToken(options.tokenFile);
  const log = openSync(options.logFile, "a");
  let pid: number;

  try {
    const proc = Bun.spawn(windowsServerArgv(options), {
      env: childEnv(),
      stdin: "ignore",
      stdout: log,
      stderr: log,
      detached: true,
    });

    proc.unref();
    pid = proc.pid;
  } finally {
    closeSync(log);
  }

  try {
    return await bound(pid, Date.now() + options.timeoutMs);
  } catch (error) {
    await killTree(pid, "SIGKILL");
    throw error;
  }
};

/** Waits for the listener a process of `pid`'s tree holds; other listeners are not ours. */
const bound = async (pid: number, deadline: number): Promise<WindowsLaunched> => {
  const notOurs = new Set<number>();

  while (Date.now() < deadline && isRunning(pid)) {
    const fresh = loopbackListeners().filter((listener) => !notOurs.has(listener.pid));
    const table = fresh.length === 0 ? "" : processTable();
    const ours = fresh.filter((listener) => isInTree(table, pid, listener.pid));

    for (const listener of fresh) if (!ours.includes(listener)) notOurs.add(listener.pid);

    if (ours.length > 1) throw new Error(`the server started holds ${ours.length} ports`);

    const [listener] = ours;

    if (listener !== undefined)
      return { pid, listen: `ws://127.0.0.1:${listener.port}`, listenerPid: listener.pid };

    await Bun.sleep(100);
  }

  throw new Error("codex app-server did not start listening");
};
