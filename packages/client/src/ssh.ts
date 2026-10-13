/**
 * The `ssh` command a Client runs to reach a remote Host's Daemon.
 *
 * Everything about *how* to reach the Host (HostName, User, Port, ProxyJump,
 * IdentityFile, …) comes from the user's `~/.ssh/config` via the alias; Polaris
 * never asks for IPs or keys. Polaris only adds:
 *
 * - on macOS/Linux, a private ControlMaster under a Polaris-owned directory, so reconnects and
 *   the several channels a Client opens reuse one authenticated connection,
 *   without touching the user's own multiplexing;
 * - `BatchMode=yes`: ssh never prompts; a prompt means Needs Attention;
 * - `StrictHostKeyChecking=yes` and `UpdateHostKeys=no`: Polaris never writes
 *   `known_hosts`, even if the user's config says `accept-new`; the user trusts
 *   a key themselves;
 * - keepalives, so a dead link is noticed in ~45s rather than at TCP timeout;
 * - compression, no forwardings of any kind, no tty and no escape character
 *   (the stream is binary);
 * - agent forwarding off unless enabled for the Host. When on, `polaris bridge`
 *   points `~/.polaris/agent.sock` on the Host at the forwarded agent, so the
 *   Daemon's long-lived processes keep a stable path across reconnects.
 */
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, win32 } from "node:path";

export interface SshOptions {
  /** The Client platform; injectable for cross-platform tests. */
  readonly platform?: NodeJS.Platform | undefined;
  /** Directory for the ControlMaster sockets; default `~/.polaris/ssh` (mode 0700). */
  readonly controlDir?: string;
  readonly controlPersist?: string;
  readonly forwardAgent?: boolean;
  readonly connectTimeoutSeconds?: number;
  readonly serverAliveIntervalSeconds?: number;
  readonly serverAliveCountMax?: number;
  /**
   * The remote command; default `DEFAULT_REMOTE_COMMAND`, the installed Daemon, since
   * `polaris` is not on PATH in a non-interactive SSH shell.
   */
  readonly remoteCommand?: ReadonlyArray<string>;
  /** Overrides system OpenSSH; Git Bash uses its own agent and known_hosts. */
  readonly sshBinary?: string | undefined;
}

/** Prefer Windows' native OpenSSH; otherwise let the process spawner search PATH. */
export const resolveSshBinary = (
  options: SshOptions = {},
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync
): string => {
  if (options.sshBinary !== undefined) return options.sshBinary;

  if ((options.platform ?? process.platform) !== "win32") return "ssh";
  const root = env.SystemRoot ?? env.SYSTEMROOT;
  const binary = root === undefined ? null : win32.join(root, "System32", "OpenSSH", "ssh.exe");

  return binary !== null && exists(binary) ? binary : "ssh";
};

/** Where `polaris install` puts the current Daemon; the remote shell expands `~`. */
export const DEFAULT_REMOTE_COMMAND: ReadonlyArray<string> = [
  "~/.polaris/bin/current/polaris",
  "bridge",
];

export const defaultControlDir = (): string => join(homedir(), ".polaris", "ssh");

export const ensureControlDir = (
  dir: string,
  platform: NodeJS.Platform = process.platform
): void => {
  if (platform === "win32") return;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
};

export const sshArgv = (alias: string, options: SshOptions = {}): Array<string> => {
  const option = (name: string, value: string | number) => ["-o", `${name}=${value}`];

  const control =
    (options.platform ?? process.platform) === "win32"
      ? []
      : [
          ...option("ControlMaster", "auto"),
          // %C hashes the local host, remote host, port and user.
          ...option("ControlPath", join(options.controlDir ?? defaultControlDir(), "%C")),
          ...option("ControlPersist", options.controlPersist ?? "10m"),
        ];

  return [
    resolveSshBinary(options),
    ...option("BatchMode", "yes"),
    ...option("StrictHostKeyChecking", "yes"),
    ...option("UpdateHostKeys", "no"),
    ...control,
    ...option("Compression", "yes"),
    ...option("ServerAliveInterval", options.serverAliveIntervalSeconds ?? 15),
    ...option("ServerAliveCountMax", options.serverAliveCountMax ?? 3),
    ...option("ConnectTimeout", options.connectTimeoutSeconds ?? 15),
    ...option("ForwardAgent", options.forwardAgent === true ? "yes" : "no"),
    ...option("ClearAllForwardings", "yes"),
    ...option("RequestTTY", "no"),
    "-T",
    "-e",
    "none",
    "--",
    alias,
    ...(options.remoteCommand ?? DEFAULT_REMOTE_COMMAND),
  ];
};
