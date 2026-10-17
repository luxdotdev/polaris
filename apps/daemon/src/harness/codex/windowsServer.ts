/**
 * The shared Codex app-server on Windows. Codex refuses a Unix socket there ("not
 * private to the current user"), so it listens on loopback: on a port it binds
 * itself (`:0`), behind a capability token in a user-only file. The port is the
 * listener a process of the started tree holds, and before anything is sent to it
 * that listener must still be the recorded one. See docs/adr/0061-windows-process-trees.md.
 */
import { closeSync, openSync } from "node:fs";
import { childEnv } from "../../service/childEnv.ts";
import { isRunning, killTree, system32 } from "../../platform/processes.ts";
import {
  identityOf,
  isInTree,
  type ProcessIdentity,
  type ProcessRow,
  processTable,
} from "../../platform/windowsTree.ts";
import { writeToken } from "./windowsToken.ts";

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

const loopbackListeners = () => {
  const result = Bun.spawnSync([system32("NETSTAT.EXE"), "-ano", "-p", "TCP"], {
    env: childEnv(),
    stdin: "ignore",
    stderr: "ignore",
    windowsHide: true,
  });

  return parseListeners(result.exitCode === 0 ? result.stdout.toString() : "");
};

/** The pid listening on the loopback `port` right now, or null if nothing is. */
export const listenerOn = (port: number): number | null =>
  loopbackListeners().find((listener) => listener.port === port)?.pid ?? null;

/** True while the recorded listener is alive and still the one on `listen`'s port. */
export const ownsListen = (listen: string, listenerPid: number): boolean => {
  const port = Number(new URL(listen).port);

  return isRunning(listenerPid) && listenerOn(port) === listenerPid;
};

/** What codex is started with: a port it binds itself, and only a holder of the token let in. */
export const serverArgs = (tokenFile: string): Array<string> => [
  "app-server",
  "--listen",
  "ws://127.0.0.1:0",
  "--ws-auth",
  "capability-token",
  "--ws-token-file",
  tokenFile,
];

export interface WindowsLaunched {
  readonly pid: number;
  readonly listen: string;
  /** The process that owns the port: codex.exe, below the shim's cmd.exe and node. */
  readonly listenerPid: number;
  /** Its creation time (a FILETIME), so a later process given its pid is never taken for it. */
  readonly listenerCreated: string;
}

/**
 * Ends a recorded server: the shim's tree when `rootIsOurs`, and its listener while that
 * is still the same process. Ending the shim can leave node and codex.exe behind.
 */
export const stopWindowsServer = async (
  state: {
    readonly pid: number;
    readonly listenerPid?: number | undefined;
    readonly listenerCreated?: string | undefined;
  },
  rootIsOurs: boolean
): Promise<number | null> => {
  if (rootIsOurs) await killTree(state.pid, "SIGKILL");

  const { listenerPid, listenerCreated } = state;
  const listener = listenerPid === undefined ? null : identityOf(listenerPid);
  const same = listener !== null && String(listener.created) === listenerCreated;

  if (same) await killTree(listener.pid, "SIGKILL");

  return rootIsOurs || same ? state.pid : null;
};

/**
 * Starts the server as the Daemon's own child, its output appended to `logFile`, and waits
 * until it is bound. Not detached: see "lives as long as the Daemon" in the ADR.
 */
export const windowsLaunch = async (options: {
  readonly codexPath: string;
  readonly tokenFile: string;
  readonly logFile: string;
  readonly timeoutMs: number;
}): Promise<WindowsLaunched> => {
  writeToken(options.tokenFile);
  const log = openSync(options.logFile, "a");
  let root: ProcessIdentity | null;

  try {
    const proc = Bun.spawn([options.codexPath, ...serverArgs(options.tokenFile)], {
      env: childEnv(),
      stdin: "ignore",
      stdout: log,
      stderr: log,
      windowsHide: true,
    });

    // Taken while Bun holds a handle to it, so the pid still names this process.
    root = identityOf(proc.pid);
    proc.unref();

    if (root === null) throw new Error("codex app-server exited at start");
  } finally {
    closeSync(log);
  }

  try {
    return await bound(root, Date.now() + options.timeoutMs);
  } catch (error) {
    await killTree(root.pid, "SIGKILL");
    throw error;
  }
};

/** Waits for the listener a process of `root`'s tree holds; other listeners are not ours. */
const bound = async (root: ProcessIdentity, deadline: number): Promise<WindowsLaunched> => {
  const notOurs = new Set<number>();

  while (Date.now() < deadline && isRunning(root.pid)) {
    const fresh = loopbackListeners().filter((listener) => !notOurs.has(listener.pid));
    const table = fresh.length === 0 ? new Map<number, ProcessRow>() : processTable();
    const ours = fresh.filter((listener) => isInTree(table, root, listener.pid));

    for (const listener of fresh) if (!ours.includes(listener)) notOurs.add(listener.pid);

    if (ours.length > 1) throw new Error(`the server started holds ${ours.length} ports`);

    const [listener] = ours;

    if (listener !== undefined)
      return {
        pid: root.pid,
        listen: `ws://127.0.0.1:${listener.port}`,
        listenerPid: listener.pid,
        listenerCreated: String(table.get(listener.pid)?.created ?? 0n),
      };

    await Bun.sleep(100);
  }

  throw new Error("codex app-server did not start listening");
};
