/**
 * The terminal hand-off: `OpenInTerminal` and `ReturnFromTerminal`. Codex's
 * TUI co-attaches to the running Harness; Claude hands off sequentially, so
 * the engine stops its Harness and follows the TUI (`terminalFollow`) until
 * the session returns.
 */
import { type SessionId, TerminalLaunch } from "@polaris/protocol";
import { Context, Duration, Effect, Exit, Fiber, Layer, Scope, Stream } from "effect";
import type { HarnessDriver } from "../harness/HarnessDriver.ts";
import type { ServiceError } from "../services.ts";
import { EngineRuntime, type TerminalFollower } from "./runtime.ts";
import { Supervisor } from "./supervisor.ts";

/** How long `ReturnFromTerminal` waits for the terminal follower to drain. */
const FOLLOWER_DRAIN = Duration.seconds(5);

const make = (
  rt: EngineRuntime["Service"],
  supervisor: Supervisor["Service"]
): TerminalHandoff["Service"] => {
  const { followers } = rt;

  /** Follow a sequentially handed-off session's terminal UI (e.g. Claude's hooks). */
  const startFollower = (sessionId: SessionId, driver: HarnessDriver) =>
    Effect.gen(function* () {
      const follow = driver.terminalFollow;

      if (follow === undefined || followers.has(sessionId)) return;

      const follower: TerminalFollower = {
        driver,
        scope: yield* Scope.make(),
        stopping: false,
        fiber: null,
      };

      followers.set(sessionId, follower);
      follower.fiber = yield* Effect.forkIn(
        follow
          .events(sessionId)
          .pipe(
            Stream.runForEach((event) =>
              supervisor
                .onHarnessEvent(sessionId, follower, event)
                .pipe(
                  Effect.catchCause((cause) =>
                    Effect.logError(`following ${event._tag} for ${sessionId} failed`, cause)
                  )
                )
            )
          ),
        rt.engineScope
      );
    });

  const stopFollower = (sessionId: SessionId, drain: boolean) =>
    Effect.gen(function* () {
      const follower = followers.get(sessionId);

      if (follower === undefined) return;
      followers.delete(sessionId);
      yield* follower.driver.terminalFollow?.release(sessionId) ?? Effect.void;

      if (follower.fiber !== null) {
        if (drain) {
          yield* Fiber.join(follower.fiber).pipe(Effect.timeout(FOLLOWER_DRAIN), Effect.ignore);
        }

        yield* Fiber.interrupt(follower.fiber);
      }

      follower.stopping = true;
      yield* Scope.close(follower.scope, Exit.void);
    });

  const openInTerminal = (sessionId: SessionId) =>
    Effect.gen(function* () {
      yield* rt.cancelIdle(sessionId);
      const entry = yield* supervisor.openHarness(sessionId);
      const argv = yield* entry.session.terminalCommand;
      const cwd = (yield* rt.store.model).sessions.get(sessionId)?.session.cwd ?? "";
      rt.terminalLaunch.set(sessionId, new TerminalLaunch({ argv: [...argv], cwd, env: {} }));

      // Claude hands off sequentially; Codex's TUI co-attaches to the running app-server.
      if (!entry.driver.capabilities.liveCoAttach) {
        yield* rt.stopHarness(sessionId);
        yield* startFollower(sessionId, entry.driver);
      }
    }).pipe(Effect.catch((error) => rt.failSession(sessionId, error.message)));

  const returnFromTerminal = (sessionId: SessionId) =>
    Effect.gen(function* () {
      rt.terminalLaunch.delete(sessionId);
      // Drain what the terminal UI did, including the cursor it ended on, before resuming.
      yield* stopFollower(sessionId, true);
      const record = (yield* rt.store.model).sessions.get(sessionId);
      const driver = record === undefined ? null : yield* rt.registry.get(record.session.harness);

      if (driver !== null && !driver.capabilities.liveCoAttach) {
        // Polaris sent no Turn while In Terminal: one still open is the terminal UI's, left unfinished.
        yield* rt.signal(sessionId, { type: "terminal.closed", at: yield* rt.now });
      }

      yield* supervisor.openHarness(sessionId);
      yield* rt.signal(sessionId, { type: "harness.resumed" });
    }).pipe(Effect.catch((error) => rt.failSession(sessionId, error.message)));

  return { openInTerminal, returnFromTerminal, stopFollower };
};

export class TerminalHandoff extends Context.Service<
  TerminalHandoff,
  {
    readonly openInTerminal: (sessionId: SessionId) => Effect.Effect<void, ServiceError>;
    readonly returnFromTerminal: (sessionId: SessionId) => Effect.Effect<void, ServiceError>;
    /** Stop following; with `drain`, first handle what the terminal UI already reported. */
    readonly stopFollower: (sessionId: SessionId, drain: boolean) => Effect.Effect<void>;
  }
>()("polaris/daemon/engine/TerminalHandoff") {
  static readonly layer = Layer.effect(
    TerminalHandoff,
    Effect.gen(function* () {
      return make(yield* EngineRuntime, yield* Supervisor);
    })
  );
}
