import { describe, expect, test } from "bun:test";
import type { ConnectionState } from "@polaris/protocol";
import {
  CONNECTION_STEPS,
  type ConnectionModel,
  connectionPaths,
  FAILURES,
  initialConnectionModel,
  LOST,
  stepConnection,
} from "./connection.testing.ts";
import {
  type ConnectionSnapshot,
  connectionMachine,
  DEFAULT_POLICY,
  initialConnection,
  MANUAL_REASONS,
  type ReconnectPolicy,
} from "./connection.ts";
import type { ConnectFailure } from "./failures.ts";

/**
 * The reconnect loop's decision as HostConnection made it before the machine
 * (commit 8ab7c81), kept as the oracle: after a failed attempt, the next state,
 * attempt count and delay.
 */
const oracle = (
  policy: ReconnectPolicy,
  before: { epoch: number; attempt: number; failingSince: number; lostAt: number | null },
  wasConnected: boolean,
  failure: ConnectFailure,
  now: number,
  jitter: number
) => {
  let { attempt, failingSince, lostAt } = before;

  if (wasConnected) {
    attempt = 0;
    failingSince = now;
    lostAt = now;
  } else {
    attempt++;
  }

  const backoff = (n: number) => {
    const base = Math.min(policy.maxDelayMs, policy.initialDelayMs * policy.factor ** n);
    const spread = base * policy.jitter;

    return Math.round(base - spread + jitter * 2 * spread);
  };

  let state: ConnectionState;
  let delay: number | null;

  const restarting =
    failure.reason === "daemon-not-running" &&
    lostAt !== null &&
    now - lostAt < policy.restartGraceMs;

  if (failure.kind === "needs-attention" && !restarting) {
    state = "needs-attention";
    delay = MANUAL_REASONS.has(failure.reason) ? null : policy.needsAttentionRetryMs;
  } else if (now - failingSince >= policy.offlineAfterMs) {
    state = "offline";
    delay = policy.offlineRetryMs;
  } else {
    state = "reconnecting";
    delay = wasConnected ? 0 : backoff(attempt - 1);
  }

  return { state, attempt, failingSince, lostAt, delay };
};

const failWith = (
  snapshot: ConnectionSnapshot,
  failure: ConnectFailure,
  now: number,
  jitter = 0.3
) => connectionMachine.transition(snapshot, { type: "failed", failure, now, jitter })[0];

describe("Connection State machine", () => {
  test("decides every failure exactly as the reconnect loop did (every reachable state)", () => {
    const failures = [...Object.values(FAILURES), LOST];
    const reached: Array<ConnectionModel> = [];

    for (const steps of connectionPaths().states) {
      let model = initialConnectionModel();

      for (const step of steps) model = stepConnection(model, step);
      reached.push(model);
    }

    // Also with the default policy and jitter, at a spread of times.
    for (const model of reached) {
      for (const policy of [model.machine.context.policy, DEFAULT_POLICY]) {
        const snapshot = { ...model.machine, context: { ...model.machine.context, policy } };

        for (const failure of failures) {
          for (const dt of [0, 1_000, 29_999, 30_000, 599_999, 600_000]) {
            for (const jitter of [0, 0.5, 0.99]) {
              const now = model.clock + dt;
              const next = failWith(snapshot, failure, now, jitter);

              const expected = oracle(
                policy,
                snapshot.context,
                snapshot.value === "connected",
                failure,
                now,
                jitter
              );

              expect({
                state: next.value,
                attempt: next.context.attempt,
                failingSince: next.context.failingSince,
                lostAt: next.context.lostAt,
                delay: next.context.delay,
              }).toEqual(expected);
            }
          }
        }
      }
    }
  });

  test("backs off 0.5 s → 2 min, and retries at once after a drop", () => {
    const policy = { ...DEFAULT_POLICY, jitter: 0 };
    let snapshot = initialConnection(policy, 0);
    const delays: Array<number | null> = [];

    for (let i = 0; i < 10; i++) {
      snapshot = failWith(snapshot, FAILURES.timeout, i);
      delays.push(snapshot.context.delay);
    }

    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 120000, 120000]);
    snapshot = connectionMachine.transition(snapshot, { type: "connected", epoch: 1 })[0];
    expect(snapshot.value).toBe("connected");
    snapshot = failWith(snapshot, LOST, 100);
    expect([snapshot.value, snapshot.context.delay, snapshot.context.attempt]).toEqual([
      "reconnecting",
      0,
      0,
    ]);
  });

  test("user-fixable failures wait for the user; install/upgrade ones are re-checked", () => {
    const start = initialConnection(DEFAULT_POLICY, 0);
    const auth = failWith(start, FAILURES["auth-failed"], 1);
    expect([auth.value, auth.context.delay]).toEqual(["needs-attention", null]);
    const missing = failWith(start, FAILURES["polaris-not-installed"], 1);
    expect([missing.value, missing.context.delay]).toEqual(["needs-attention", 120_000]);
    const retried = connectionMachine.transition(auth, { type: "retry" })[0];
    expect([retried.value, retried.context.delay]).toEqual(["reconnecting", null]);
  });

  test("no Daemon right after a drop is a restart, until the grace runs out", () => {
    let snapshot = connectionMachine.transition(initialConnection(DEFAULT_POLICY, 0), {
      type: "connected",
      epoch: 1,
    })[0];

    snapshot = failWith(snapshot, LOST, 1_000);
    const within = failWith(snapshot, FAILURES["daemon-not-running"], 30_999);
    expect(within.value).toBe("reconnecting");
    const after = failWith(snapshot, FAILURES["daemon-not-running"], 31_000);
    expect(after.value).toBe("needs-attention");
  });

  test("transient failures for 10 minutes make the Host Offline", () => {
    const start = initialConnection(DEFAULT_POLICY, 0);
    expect(failWith(start, FAILURES.timeout, 599_999).value).toBe("reconnecting");
    const offline = failWith(start, FAILURES.timeout, 600_000);
    expect([offline.value, offline.context.delay]).toEqual(["offline", 600_000]);
  });

  test("graph path counts", () => {
    const paths = connectionPaths();
    // Update README.md when these move.
    expect([paths.states.length, paths.transitions.length, CONNECTION_STEPS.length]).toEqual([
      155, 580, 9,
    ]);
  });
});
