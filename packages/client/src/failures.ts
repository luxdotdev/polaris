/**
 * Why a connection attempt failed, and whether the Client can fix it by
 * retrying (transient: Reconnecting, later Offline) or needs the user
 * (Needs Attention). Classification reads OpenSSH's exit status and stderr;
 * with `BatchMode=yes` ssh never prompts, it fails with one of these instead.
 */
import { BRIDGE_EXIT_NO_DAEMON } from "@polaris/protocol";
import { Schema } from "effect";

export const NeedsAttentionReason = Schema.Literals([
  /** The Host's key differs from known_hosts: possible MITM, or the machine was rebuilt. */
  "host-key-changed",
  /** The Host isn't in known_hosts; the user must accept its key once in a terminal. */
  "host-key-unknown",
  /** No key was accepted (or the server wants a password / 2FA, which we never answer). */
  "auth-failed",
  /** ssh refused to use the config or a key file (bad owner or permissions, bad option). */
  "ssh-config-error",
  "ssh-missing",
  "command-missing",
  /** `polaris` is not on the Host's PATH: the install flow is needed. */
  "polaris-not-installed",
  /** `polaris bridge` ran but no Daemon is listening on the Host. */
  "daemon-not-running",
  /** The Daemon speaks another protocol version: the upgrade flow is needed. */
  "protocol-mismatch",
]);
export type NeedsAttentionReason = typeof NeedsAttentionReason.Type;

export const TransientReason = Schema.Literals([
  "unreachable",
  "timeout",
  "connection-lost",
  "connection-failed",
  "spawn-failed",
]);
export type TransientReason = typeof TransientReason.Type;

export class ConnectFailure extends Schema.TaggedError<ConnectFailure>()("ConnectFailure", {
  kind: Schema.Literals(["transient", "needs-attention"]),
  reason: Schema.Union([NeedsAttentionReason, TransientReason]),
  /** A short human-readable line, usually the relevant stderr line. */
  detail: Schema.String,
}) {}

const needs = (reason: NeedsAttentionReason, detail: string) =>
  new ConnectFailure({ kind: "needs-attention", reason, detail });

const transient = (reason: TransientReason, detail: string) =>
  new ConnectFailure({ kind: "transient", reason, detail });

const lastLine = (stderr: string, pattern?: RegExp): string => {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("@@@"));
  if (pattern !== undefined) {
    const match = lines.find((l) => pattern.test(l));
    if (match !== undefined) return match;
  }
  return lines.at(-1) ?? "";
};

/** Classifies how `ssh … polaris bridge` (or a replacement command) ended. */
export const classifyExit = (exit: {
  readonly code: number | null;
  readonly signal: string | null;
  readonly stderr: string;
}): ConnectFailure => {
  const { code, stderr } = exit;
  const has = (pattern: RegExp) => pattern.test(stderr);

  if (code === BRIDGE_EXIT_NO_DAEMON || has(/no Daemon is running/))
    return needs("daemon-not-running", lastLine(stderr, /no Daemon/));
  if (has(/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key for .* has changed/))
    return needs("host-key-changed", lastLine(stderr, /IDENTIFICATION|has changed/));
  if (has(/Host key verification failed|No .* host key is known/))
    return needs("host-key-unknown", lastLine(stderr, /Host key|host key/));
  if (
    has(
      /Bad owner or permissions|Bad configuration option|Can't open user config|UNPROTECTED PRIVATE KEY/
    )
  )
    return needs("ssh-config-error", lastLine(stderr, /Bad|Can't|UNPROTECTED/));
  if (has(/Permission denied|Too many authentication failures|Authentication failed/))
    return needs(
      "auth-failed",
      lastLine(stderr, /Permission denied|authentication|Authentication/)
    );
  if (code === 127 || has(/polaris: (command )?not found|command not found: polaris/))
    return needs("polaris-not-installed", lastLine(stderr, /not found/));
  if (has(/Could not resolve hostname|Network is unreachable|No route to host|Connection refused/))
    return transient("unreachable", lastLine(stderr, /resolve|unreachable|route|refused/));
  if (has(/timed out|Timeout/)) return transient("timeout", lastLine(stderr, /timed out|Timeout/));
  const line = lastLine(stderr);
  return transient(
    "connection-lost",
    line.length > 0 ? line : `exited with ${code ?? exit.signal ?? "unknown status"}`
  );
};
