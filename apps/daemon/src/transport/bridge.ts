/**
 * `polaris bridge`: what `ssh <host> polaris bridge` runs. Pipes stdin/stdout
 * to the local Daemon socket byte for byte, with backpressure both ways, and
 * exits when either side closes. Frames pass through untouched; the bridge
 * never parses them.
 *
 * If no Daemon is listening and the Host uses Polaris' fallback supervisor
 * (`~/.polaris/bin/polaris-supervise`: Linux without systemd --user), the
 * bridge starts the supervisor, waits up to 5 s for the socket and tries
 * once more; nothing else may have started it since a reboot. With a systemd
 * --user unit it waits the same 5 s without starting anything: a WSL distro
 * boots for the bridge, and systemd starts the Daemon a moment later. On Windows
 * it runs the user's scheduled task (`schtasks /Run`) and waits the same. Otherwise it
 * prints a reason on stderr and exits with BRIDGE_EXIT_NO_DAEMON, which the
 * Client maps to Needs Attention.
 *
 * On Windows the Daemon's pipe counts only when this user owns it, checked on the
 * handle the bytes then use (ADR 0059): any other owner means another account took
 * the name first, and the bridge exits with BRIDGE_EXIT_UNTRUSTED_DAEMON having sent nothing.
 *
 * With agent forwarding on for the Host, ssh sets SSH_AUTH_SOCK for this
 * process; the bridge repoints `~/.polaris/agent.sock` at it, so the Daemon and
 * its Harnesses can use one stable path that survives reconnects.
 */
import { childEnv } from "../service/childEnv.ts";
import { renameSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { connect } from "node:net";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { BRIDGE_EXIT_NO_DAEMON, BRIDGE_EXIT_UNTRUSTED_DAEMON } from "@polaris/protocol/bridge";
import { paths } from "../paths.ts";
import { system32 } from "../platform/processes.ts";
import { SYSTEMD_UNIT } from "../service/templates.ts";
import { realProfileDirectory } from "../service/windowsProfile.ts";
import { windowsTaskName } from "../service/windowsTask.ts";

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
  pause(): void;
  resume(): void;
}

interface Sink {
  write(chunk: Uint8Array, callback: () => void): boolean;
  once(event: "drain", listener: () => void): void;
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
  /**
   * The systemd `--user` unit (`~/.config/systemd/user/polaris.service`). When no
   * Daemon answers and it exists, systemd may still be starting it (a WSL distro
   * that just booted for this bridge), so the bridge waits for the socket. Null turns that off.
   */
  readonly systemdUnit?: string | null;
  /** How long to wait for the Daemon after starting the supervisor, or for systemd's. */
  readonly waitMs?: number;
}

const defaultSystemdUnit = () =>
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "systemd", "user", SYSTEMD_UNIT);

const spawnSupervisor = (script: string) => {
  // Without arguments the script detaches itself (setsid, else nohup) and returns at once.
  Bun.spawn([script], {
    env: childEnv(),
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  }).unref();
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

/** Starts the fallback supervisor if this Host has one; false when it has none or it failed. */
const startSupervisor = (options: BridgeOptions): boolean => {
  const script =
    options.supervisor === undefined ? join(paths().bin, "polaris-supervise") : options.supervisor;

  if (script === null || !isFile(script)) return false;

  try {
    spawnSupervisor(script);

    return true;
  } catch {
    return false;
  }
};

/** Windows: runs this home's scheduled task; false when it isn't installed or won't run. */
const runWindowsTask = (): boolean => {
  if (process.platform !== "win32") return false;
  const name = windowsTaskName(userInfo().username, paths().root, realProfileDirectory());

  try {
    const run = Bun.spawnSync([system32("schtasks.exe"), "/Run", "/TN", name], {
      env: childEnv(),
      stdout: "ignore",
      stderr: "ignore",
    });

    return run.exitCode === 0;
  } catch {
    return false;
  }
};

/**
 * On a Host that relies on the fallback supervisor (nothing may have started
 * it since a reboot), start it; under systemd, systemd starts it. Then wait up
 * to `waitMs` for the socket. False when neither applies or no Daemon came up.
 */
const startDaemonViaSupervisor = async (
  socketPath: string,
  options: BridgeOptions
): Promise<boolean> => {
  const unit = options.systemdUnit === undefined ? defaultSystemdUnit() : options.systemdUnit;

  if (!startSupervisor(options) && !runWindowsTask() && (unit === null || !isFile(unit)))
    return false;

  const deadline = Date.now() + (options.waitMs ?? SUPERVISOR_START_WAIT_MS);

  for (;;) {
    if (await probeSocket(socketPath)) return true;

    if (Date.now() >= deadline) return false;
    await Bun.sleep(100);
  }
};

/** A connection to the Daemon: a Unix socket, or on Windows the adopted pipe handle. */
interface DaemonStream extends Source, Sink {
  on(event: "data", listener: (chunk: Uint8Array) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  once(event: "drain" | "close", listener: () => void): void;
  end(): void;
}

type Opened =
  | { readonly kind: "connected"; readonly stream: DaemonStream }
  | { readonly kind: "absent"; readonly detail: string }
  | { readonly kind: "untrusted"; readonly message: string };

const openSocket = (socketPath: string): Promise<Opened> =>
  new Promise((resolve) => {
    const socket = connect(socketPath);

    const refused = (error: NodeJS.ErrnoException) => {
      socket.destroy();
      resolve({ kind: "absent", detail: error.code ?? error.message });
    };

    socket.once("error", refused);
    socket.once("connect", () => {
      socket.off("error", refused);
      resolve({ kind: "connected", stream: socket });
    });
  });

/** Windows: the pipe only counts when this user owns it, checked on the handle then used. */
const openPipe = async (pipeName: string): Promise<Opened> => {
  const { connectOwnPipe, untrustedMessage } = await import("./windowsPipe/client.ts");
  const pipe = await connectOwnPipe(pipeName);

  if (pipe.kind === "connected") return pipe;

  if (pipe.kind === "absent") return { kind: "absent", detail: `Win32 error ${pipe.code}` };

  return { kind: "untrusted", message: untrustedMessage(pipeName, pipe) };
};

const openDaemon = (socketPath: string): Promise<Opened> =>
  process.platform === "win32" ? openPipe(socketPath) : openSocket(socketPath);

export const runBridge = (options: BridgeOptions = {}): Promise<number> =>
  new Promise((resolve) => {
    const socketPath = options.socketPath ?? paths().socket;
    linkForwardedAgent();
    const stdin = process.stdin;
    const stdout = process.stdout;
    let settled = false;
    let retried = false;
    // Bytes the Client sent before the Daemon connected (across a retry, too).
    let early: Array<Uint8Array> | null = [];
    let stdinEnded = false;
    let daemon: DaemonStream | null = null;
    let toDaemon: ((chunk: Uint8Array) => void) | null = null;

    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      stdin.pause();
      stdin.removeAllListeners("data");
      // Let buffered output reach the Client before exiting.
      stdout.write(new Uint8Array(0), () => resolve(code));
    };

    stdin.on("data", (chunk: Uint8Array) => {
      if (toDaemon === null) early?.push(chunk);
      else toDaemon(chunk);
    });
    stdin.once("end", () => {
      stdinEnded = true;

      if (toDaemon !== null) daemon?.end();
    });

    const attach = (stream: DaemonStream) => {
      daemon = stream;
      const forward = pipe(stdin, stream);
      toDaemon = forward;
      const buffered = early ?? [];
      early = null;

      for (const chunk of buffered) forward(chunk);

      if (stdinEnded) stream.end();
      stream.on("data", pipe(stream, stdout));

      let failed = false;
      stream.on("error", (error: Error) => {
        if (failed) return;
        failed = true;
        process.stderr.write(`polaris bridge: connection to the Daemon failed: ${error.message}\n`);
        finish(1);
      });
      stream.once("close", () => finish(0));
    };

    const noDaemon = (detail: string) => {
      process.stderr.write(
        `polaris bridge: no Daemon is running on this Host (nothing listening on ${socketPath}: ${detail})\n`
      );
      finish(BRIDGE_EXIT_NO_DAEMON);
    };

    const attempt = async (): Promise<void> => {
      const opened = await openDaemon(socketPath);

      if (opened.kind === "connected") return attach(opened.stream);

      if (opened.kind === "untrusted") {
        process.stderr.write(`polaris bridge: ${opened.message}\n`);

        return finish(BRIDGE_EXIT_UNTRUSTED_DAEMON);
      }

      if (retried) return noDaemon(opened.detail);
      retried = true;
      const up = await startDaemonViaSupervisor(socketPath, options);

      return up ? attempt() : noDaemon(opened.detail);
    };

    attempt().catch((error: Error) => {
      process.stderr.write(`polaris bridge: ${String(error)}\n`);
      finish(1);
    });
  });

/**
 * `polaris bridge [--relay <pid>]`. On Windows, `--relay` names the PowerShell process that
 * feeds stdin (`@polaris/client/install`'s relay): it would wait for the Client's next line
 * and hold the SSH channel open, so the bridge ends it with its own exit status.
 */
export const runBridgeCommand = async (args: ReadonlyArray<string>): Promise<number> => {
  const code = await runBridge();
  const at = args.indexOf("--relay");
  const relay = at >= 0 ? Number(args[at + 1]) : Number.NaN;

  if (process.platform === "win32" && Number.isSafeInteger(relay) && relay > 0) {
    const { terminateProcess } = await import("./windowsPipe/win32.ts");
    terminateProcess(relay, code);
  }

  return code;
};
