/**
 * The Connection State policy as a flat state machine (`xstate/fsm`, a pure
 * transition table of a few hundred bytes): Connected, Reconnecting, Needs
 * Attention, Offline (CONTEXT.md). `HostConnection` runs the attempts and the
 * timers; this decides, after every attempt, which Connection State the Host
 * is in and how long to wait before the next attempt. See README.md.
 *
 * - Before the first connection and after a drop: Reconnecting. Retries back
 *   off exponentially from `initialDelayMs` to `maxDelayMs`, with jitter; the
 *   first retry after a drop is immediate.
 * - A failure only the user can fix (host key, auth, ssh config, missing ssh)
 *   is Needs Attention with no automatic retry until `retry` (so sshd is never
 *   hammered with failing auth). One the install/upgrade flow can fix (not
 *   installed, no Daemon, protocol mismatch) is Needs Attention re-checked
 *   every `needsAttentionRetryMs`.
 * - Right after a drop, "no Daemon running" counts as a Daemon restart for
 *   `restartGraceMs`: still Reconnecting.
 * - Transient failures for `offlineAfterMs` since the last good connection:
 *   Offline, retried every `offlineRetryMs`.
 */
import type { ConnectionState } from "@polaris/protocol";
import { setup, types } from "xstate/fsm";
import type { ConnectFailure } from "./failures.ts";

export interface ReconnectPolicy {
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly factor: number;
  readonly jitter: number;
  readonly offlineAfterMs: number;
  readonly offlineRetryMs: number;
  readonly needsAttentionRetryMs: number;
  readonly helloTimeoutMs: number;
  /** After a drop, how long "no Daemon running" still counts as a restart (Reconnecting). */
  readonly restartGraceMs: number;
}

export const DEFAULT_POLICY: ReconnectPolicy = {
  initialDelayMs: 500,
  maxDelayMs: 120_000,
  factor: 2,
  jitter: 0.2,
  offlineAfterMs: 10 * 60_000,
  offlineRetryMs: 10 * 60_000,
  needsAttentionRetryMs: 120_000,
  helloTimeoutMs: 20_000,
  restartGraceMs: 30_000,
};

/** Reasons the user must fix; no automatic retry until `retry`. */
export const MANUAL_REASONS: ReadonlySet<ConnectFailure["reason"]> = new Set([
  "host-key-changed",
  "host-key-unknown",
  "auth-failed",
  "ssh-config-error",
  "ssh-missing",
  "command-missing",
]);

export interface ConnectionContext {
  readonly policy: ReconnectPolicy;
  /** The connection count; a `connected` sets it. */
  readonly epoch: number;
  /** Consecutive failed attempts since the last good connection. */
  readonly attempt: number;
  /** Since when attempts have been failing (the last good connection, or the start). */
  readonly failingSince: number;
  /** When the last good connection dropped; null before the first. */
  readonly lostAt: number | null;
  /** The most recent failure. */
  readonly failure: ConnectFailure | null;
  /** How long to wait before the next attempt; null: until the user retries. */
  readonly delay: number | null;
}

export type ConnectionEvent =
  /** An attempt reached the Daemon (hello answered). */
  | { readonly type: "connected"; readonly epoch: number }
  /**
   * An attempt failed, or the connection it made ended. `jitter` in [0, 1)
   * spreads the backoff (Math.random in production), so the machine stays pure.
   */
  | {
      readonly type: "failed";
      readonly failure: ConnectFailure;
      readonly now: number;
      readonly jitter: number;
    }
  /** The user asked to try now (`retryNow`), whatever the state. */
  | { readonly type: "retry" };

const backoff = (policy: ReconnectPolicy, attempt: number, jitter: number) => {
  const base = Math.min(policy.maxDelayMs, policy.initialDelayMs * policy.factor ** attempt);
  const spread = base * policy.jitter;
  return Math.round(base - spread + jitter * 2 * spread);
};

type Failed = Extract<ConnectionEvent, { type: "failed" }>;

/** Where a failed attempt leaves the Host, from any state. */
const failed = (
  { context, event }: { context: ConnectionContext; event: Failed },
  wasConnected: boolean
) => {
  const { policy } = context;
  const { failure, now } = event;
  const attempt = wasConnected ? 0 : context.attempt + 1;
  const failingSince = wasConnected ? now : context.failingSince;
  const lostAt = wasConnected ? now : context.lostAt;
  const base = { attempt, failingSince, lostAt, failure };
  // Right after a drop, "no Daemon" is most likely a Daemon restart: keep Reconnecting.
  const restarting =
    failure.reason === "daemon-not-running" &&
    lostAt !== null &&
    now - lostAt < policy.restartGraceMs;
  if (failure.kind === "needs-attention" && !restarting) {
    return {
      target: "needs-attention" as const,
      context: {
        ...base,
        delay: MANUAL_REASONS.has(failure.reason) ? null : policy.needsAttentionRetryMs,
      },
    };
  }
  if (now - failingSince >= policy.offlineAfterMs) {
    return { target: "offline" as const, context: { ...base, delay: policy.offlineRetryMs } };
  }
  return {
    target: "reconnecting" as const,
    context: {
      ...base,
      delay: wasConnected ? 0 : backoff(policy, attempt - 1, event.jitter),
    },
  };
};

const retry = { target: "reconnecting" as const, context: { delay: null } };

export const connectionMachine = setup({
  schemas: {
    context: types<ConnectionContext>(),
    events: {
      connected: types<Omit<Extract<ConnectionEvent, { type: "connected" }>, "type">>(),
      failed: types<Omit<Failed, "type">>(),
      retry: types<Record<never, never>>(),
    },
  },
}).createFSM({
  id: "connection",
  initial: "reconnecting",
  context: {
    policy: DEFAULT_POLICY,
    epoch: 0,
    attempt: 0,
    failingSince: 0,
    lostAt: null,
    failure: null,
    delay: null,
  },
  states: {
    reconnecting: {
      on: {
        connected: ({ event }) => ({ target: "connected", context: connectedWith(event.epoch) }),
        failed: (args) => failed(args, false),
        retry,
      },
    },
    connected: {
      on: {
        failed: (args) => failed(args, true),
      },
    },
    "needs-attention": {
      on: {
        connected: ({ event }) => ({ target: "connected", context: connectedWith(event.epoch) }),
        failed: (args) => failed(args, false),
        retry,
      },
    },
    offline: {
      on: {
        connected: ({ event }) => ({ target: "connected", context: connectedWith(event.epoch) }),
        failed: (args) => failed(args, false),
        retry,
      },
    },
  },
});

function connectedWith(epoch: number) {
  return { epoch, attempt: 0, failure: null, delay: null };
}

export type ConnectionSnapshot = typeof connectionMachine.initialState;

/** The snapshot a new HostConnection starts from: Reconnecting, failing since `now`. */
export const initialConnection = (policy: ReconnectPolicy, now: number): ConnectionSnapshot => ({
  ...connectionMachine.initialState,
  context: { ...connectionMachine.initialState.context, policy, failingSince: now },
});

export const connectionStateOf = (snapshot: ConnectionSnapshot): ConnectionState => snapshot.value;
