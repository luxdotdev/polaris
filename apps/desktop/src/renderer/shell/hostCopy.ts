/**
 * What a Host's Connection State means, in words (rule/say-what-happened,
 * rule/glossary-lowercase): never the client's raw error or a socket path.
 */
import type { ConnectionState } from "@polaris/protocol";
import { Match } from "effect";
import type { HostView } from "../../shared/api.ts";

/** A round trip this slow makes typing into a remote agent feel it: shown as "Slow link". */
export const SLOW_LINK_MS = 250;

export const isSlowLink = (host: HostView) =>
  host.status.state === "connected" &&
  host.status.latencyMs !== null &&
  host.status.latencyMs >= SLOW_LINK_MS;

const TRANSIENT = new Map<string, (label: string) => string>(
  Object.entries({
    unreachable: (l: string) => `${l} can't be reached.`,
    timeout: (l: string) => `${l} isn't answering.`,
    "connection-lost": (l: string) => `The connection to ${l} dropped.`,
    "connection-failed": (l: string) => `Couldn't connect to ${l}.`,
    "spawn-failed": (): string => "ssh couldn't start on this Mac.",
    "daemon-not-running": (l: string) => `The daemon on ${l} is restarting.`,
  })
);

const ATTENTION = new Map<string, (label: string) => string>(
  Object.entries({
    "host-key-unknown": (l: string) => `${l}'s host key isn't trusted yet.`,
    "host-key-changed": (l: string) => `${l}'s host key changed.`,
    "auth-failed": (l: string) => `${l} refused the key.`,
    "ssh-config-error": (): string => "ssh refused its config for this host.",
    "ssh-missing": (): string => "ssh isn't installed on this Mac.",
    "command-missing": (l: string) => `The Polaris command is missing on ${l}.`,
    "polaris-not-installed": (l: string) => `Polaris isn't installed on ${l}.`,
    "daemon-not-running": (l: string) => `The daemon on ${l} isn't running.`,
    "protocol-mismatch": (l: string) => `${l} runs an older daemon.`,
  })
);

/** One or two sentences for the sidebar while the Host isn't connected. */
export const hostSentence = (host: HostView, since: string | undefined): string => {
  const { state, failure } = host.status;
  const reason = failure?.reason ?? "";

  if (state === "needs-attention") {
    return ATTENTION.get(reason)?.(host.label) ?? `${host.label} needs attention.`;
  }

  const what = TRANSIENT.get(reason)?.(host.label) ?? `${host.label} isn't connected.`;

  if (state === "offline") {
    return `${what} Offline since ${since ?? "a while"}; Polaris checks again every 10 minutes.`;
  }

  return `${what} Reconnecting${since === undefined ? "" : ` for ${since}`}; its sessions are kept.`;
};

/** A Connection State as a short caption after a Host's name; null when connected. */
export const stateWords = (state: ConnectionState): string | null =>
  Match.value(state).pipe(
    Match.when("reconnecting", () => "reconnecting"),
    Match.when("offline", () => "offline"),
    Match.when("needs-attention", () => "needs attention"),
    Match.orElse(() => null)
  );
