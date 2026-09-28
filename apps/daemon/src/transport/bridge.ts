/**
 * `polaris bridge`: what `ssh <host> polaris bridge` runs. Pipes stdin/stdout
 * to the local Daemon socket byte for byte, with backpressure both ways, and
 * exits when either side closes. Frames pass through untouched; the bridge
 * never parses them.
 *
 * If no Daemon is listening and the Host uses Polaris' fallback supervisor
 * (`~/.polaris/bin/polaris-supervise`: Linux without systemd --user), the
 * bridge starts the supervisor, waits up to 5 s for the socket and tries
 * once more; nothing else may have started it since a reboot. Otherwise it
 * prints a reason on stderr and exits with BRIDGE_EXIT_NO_DAEMON, which the
 * Client maps to Needs Attention.
 *
 * With agent forwarding on for the Host, ssh sets SSH_AUTH_SOCK for this
 * process; the bridge repoints `~/.polaris/agent.sock` at it, so the Daemon and
 * its Harnesses can use one stable path that survives reconnects.
 */
import { renameSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { BRIDGE_EXIT_NO_DAEMON } from "@polaris/protocol/bridge";
import { paths } from "../paths.ts";

/** The stable agent socket path on this Host (a symlink to the latest forwarded agent). */
export const agentSocketPath = (): string => join(paths().root, "agent.sock");

const linkForwardedAgent = () => {
  const forwarded = process.env.SSH_AUTH_SOCK;
  if (forwarded === undefined || forwarded === agentSocketPath()) return;
  try {
    if (!statSync(forwarded).isSocket()) return;
    const temp = `${agentSocketPath()}.${process.pid}`;
    try {
      unlinkSync(temp);
    } catch {}
    symlinkSync(forwarded, temp);
    renameSync(temp, agentSocketPath());
  } catch {
    // Best effort: agent forwarding is optional.
  }
};

interface Source {
  pause(): unknown;
  resume(): unknown;
}
interface Sink {
  write(chunk: Uint8Array, callback: () => void): boolean;
  once(event: "drain", listener: () => void): unknown;
}

/**
 * Forwards chunks into `sink`, pausing `source` while the sink is backed up.
 * Resumes on the write callbacks as well as `drain`, which Bun does not always
 * emit for sockets.
 */
const pipe = (source: Source, sink: Sink) => {
  let inflight = 0;
  let paused = false;
  const resume = () => {
    if (paused) {
      paused = false;
      source.resume();
    }
  };
  return (chunk: Uint8Array) => {
    inflight++;
    const ok = sink.write(chunk, () => {
      inflight--;
      if (inflight === 0) resume();
    });
    if (!ok && !paused) {
      paused = true;
      source.pause();
      sink.once("drain", resume);
    }
  };
};

/** How long the bridge waits for a Daemon the fallback supervisor just started. */
export const SUPERVISOR_START_WAIT_MS = 5000;

export interface BridgeOptions {
  readonly socketPath?: string;
  /**
   * The fallback supervisor script (`~/.polaris/bin/polaris-supervise`, Linux
   * without systemd --user). When no Daemon answers and this file exists, the
   * bridge starts it and tries once more. Null turns that off.
   */
  readonly supervisor?: string | null;
  /** How long to wait for the Daemon after starting the supervisor. */
  readonly waitMs?: number;
}

const spawnSupervisor = (script: string) => {
  // Without arguments the script detaches itself (setsid, else nohup) and returns at once.
  Bun.spawn([script], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
};

/** Resolves true once something accepts a connection on `socketPath`. */
const probeSocket = (socketPath: string): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect(socketPath);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });

const isFile = (path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/**
 * On a Host that relies on the fallback supervisor (nothing may have started
 * it since a reboot), start it and wait up to `waitMs` for the Daemon's
 * socket. False when there is no supervisor or the Daemon did not come up.
 */
const startDaemonViaSupervisor = async (
  socketPath: string,
  options: BridgeOptions
): Promise<boolean> => {
  const script =
    options.supervisor === undefined ? join(paths().bin, "polaris-supervise") : options.supervisor;
  if (script === null || !isFile(script)) return false;
  try {
    spawnSupervisor(script);
  } catch {
    return false;
  }
  const deadline = Date.now() + (options.waitMs ?? SUPERVISOR_START_WAIT_MS);
  for (;;) {
    if (await probeSocket(socketPath)) return true;
    if (Date.now() >= deadline) return false;
    await Bun.sleep(100);
  }
};

export const runBridge = (options: BridgeOptions = {}): Promise<number> =>
  new Promise((resolve) => {
    const socketPath = options.socketPath ?? paths().socket;
    linkForwardedAgent();
    const stdin = process.stdin;
    const stdout = process.stdout;
    let settled = false;
    let retried = false;
    // Bytes the Client sent before the socket connected (across a retry, too).
    let early: Array<Uint8Array> | null = [];
    let stdinEnded = false;
    let socket: Socket | null = null;
    let toSocket: ((chunk: Uint8Array) => void) | null = null;

    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      stdin.pause();
      stdin.removeAllListeners("data");
      // Let buffered output reach the Client before exiting.
      stdout.write(new Uint8Array(0), () => resolve(code));
    };

    stdin.on("data", (chunk: Uint8Array) => {
      if (toSocket === null) early?.push(chunk);
      else toSocket(chunk);
    });
    stdin.once("end", () => {
      stdinEnded = true;
      if (toSocket !== null) socket?.end();
    });

    const attempt = () => {
      const current = connect(socketPath);
      socket = current;
      let connected = false;

      current.once("connect", () => {
        connected = true;
        const forward = pipe(stdin, current);
        toSocket = forward;
        const buffered = early ?? [];
        early = null;
        for (const chunk of buffered) forward(chunk);
        if (stdinEnded) current.end();
      });

      current.on("data", pipe(current, stdout));

      let failed = false;
      current.on("error", (error: NodeJS.ErrnoException) => {
        if (failed) return;
        failed = true;
        if (connected) {
          process.stderr.write(
            `polaris bridge: connection to the Daemon failed: ${error.message}\n`
          );
          finish(1);
          return;
        }
        const noDaemon = () => {
          process.stderr.write(
            `polaris bridge: no Daemon is running on this Host (nothing listening on ${socketPath}: ${error.code ?? error.message})\n`
          );
          finish(BRIDGE_EXIT_NO_DAEMON);
        };
        if (retried) return noDaemon();
        retried = true;
        void startDaemonViaSupervisor(socketPath, options).then((up) =>
          up ? attempt() : noDaemon()
        );
      });

      current.once("close", () => {
        if (connected) finish(0);
      });
    };
    attempt();
  });
