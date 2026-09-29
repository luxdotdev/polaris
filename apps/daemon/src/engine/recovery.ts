/**
 * Recovery: the session machine's `daemon.recover`, sent to every session when
 * the Engine starts (cause `restart`) and to the sessions whose Harness lives in
 * the Daemon process right before an upgrade exec (cause `upgrade`).
 * See docs/adr/0004-restart-recovery-never-continues-a-turn.md.
 */
import { Effect } from "effect";
import type { EngineRuntime } from "./runtime.ts";
import { decideSession, type SessionInput } from "./session.ts";

/** Recover every session after a Daemon restart, before the Engine serves anything. */
export const recoverOnStart = (rt: EngineRuntime["Service"]) =>
  Effect.gen(function* () {
    const model = yield* rt.store.model;
    const at = yield* rt.now;

    for (const record of model.sessions.values()) {
      const input: SessionInput = { type: "daemon.recover", cause: "restart", at };

      // Most sessions (Dormant, Archived) have nothing to recover: skip their commit.
      if (decideSession(record, input).events.length === 0) continue;
      yield* rt.signal(record.session.id, input);
    }
  }).pipe(Effect.orDie);

/**
 * Stop every Harness that lives in the Daemon process (`liveCoAttach: false`)
 * and recover its session now; Codex threads outlive the exec and are left alone.
 */
export const prepareForUpgrade = (rt: EngineRuntime["Service"]) =>
  Effect.gen(function* () {
    const inProcess = [...rt.live.entries()].flatMap(([id, entry]) =>
      entry.driver.capabilities.liveCoAttach ? [] : [id]
    );

    yield* Effect.forEach(
      inProcess,
      (sessionId) =>
        rt
          .serially(sessionId)(
            Effect.gen(function* () {
              yield* rt.cancelIdle(sessionId);
              yield* rt.stopHarness(sessionId);
              yield* rt.signal(sessionId, {
                type: "daemon.recover",
                cause: "upgrade",
                at: yield* rt.now,
              });
            })
          )
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logError(`preparing ${sessionId} for the upgrade failed`, cause)
            )
          ),
      { concurrency: "unbounded", discard: true }
    );
  }).pipe(Effect.withSpan("Engine.prepareForUpgrade"));
