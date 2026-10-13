/**
 * Resume at reset: a Limited session the user opted in for gets a Continue when its usage
 * limit resets. One sleeping fiber per such session and nothing otherwise, so an idle
 * Daemon stays idle; the schedule is derived from the log, so a restart re-arms it.
 */
import { Command, CommandId, DomainEvent, type SessionId } from "@polaris/protocol";
import { Clock, Context, Duration, Effect, Fiber, Layer, Predicate, Stream } from "effect";
import { lastTurn, type SessionRecord } from "../store/model.ts";
import { Dispatcher } from "./dispatch.ts";
import { EngineConfig, EngineRuntime } from "./runtime.ts";

/** Who the Continue reads as in the log: Polaris, not a Client device. */
export const RESUME_DEVICE = "Polaris (resume at reset)";

/** Providers reset on the minute; a short wait keeps the first call from landing just before. */
const DEFAULT_GRACE = Duration.seconds(30);

interface Timer {
  readonly key: string;
  readonly fiber: Fiber.Fiber<void>;
}

/** The Continue this session is due, as a stable key, or null when none is. */
export const resumeDue = (record: SessionRecord | undefined) => {
  const session = record?.session;
  const turn = record && lastTurn(record);

  if (
    session === undefined ||
    turn === undefined ||
    session.state !== "limited" ||
    !session.resumeAtReset ||
    session.limitResetsAt == null
  )
    return null;

  return {
    at: session.limitResetsAt,
    key: `resume-at-reset:${session.id}:${turn.id}:${session.limitResetsAt}`,
  };
};

/** The session whose schedule this event may move, or null. */
const watched = (event: DomainEvent): SessionId | null =>
  Predicate.isTagged(event, "SessionStateChanged") ||
  Predicate.isTagged(event, "SessionResumeAtResetChanged")
    ? event.sessionId
    : null;

const make = Effect.gen(function* () {
  const rt = yield* EngineRuntime;
  const { dispatch } = yield* Dispatcher;
  const config = yield* EngineConfig;
  const grace = Duration.toMillis(config.resumeAtResetGrace ?? DEFAULT_GRACE);
  const timers = new Map<SessionId, Timer>();

  /** The key is the command id too: a repeat (or a restart mid-dispatch) replays the receipt. */
  const fire = (sessionId: SessionId, key: string) =>
    Effect.gen(function* () {
      timers.delete(sessionId);

      if (resumeDue((yield* rt.store.model).sessions.get(sessionId))?.key !== key) return;
      yield* dispatch({
        commandId: CommandId.make(key),
        command: Command.cases.Continue.make({ sessionId }),
        deviceLabel: RESUME_DEVICE,
      });
    }).pipe(Effect.catchCause((cause) => Effect.logWarning("resume at reset failed", cause)));

  const sync = (sessionId: SessionId) =>
    Effect.gen(function* () {
      const due = resumeDue((yield* rt.store.model).sessions.get(sessionId));
      const timer = timers.get(sessionId);

      if (timer?.key === due?.key) return;

      if (timer !== undefined) {
        timers.delete(sessionId);
        yield* Fiber.interrupt(timer.fiber);
      }

      if (due === null) return;
      const wait = Math.max(0, Date.parse(due.at) + grace - (yield* Clock.currentTimeMillis));

      const fiber = yield* Effect.sleep(Duration.millis(wait)).pipe(
        Effect.andThen(fire(sessionId, due.key)),
        Effect.forkIn(rt.engineScope)
      );

      timers.set(sessionId, { key: due.key, fiber });
    });

  const start = Effect.gen(function* () {
    yield* Effect.forkIn(
      Effect.scoped(
        Effect.gen(function* () {
          const live = yield* rt.store.subscribe({
            filter: (item) =>
              Predicate.isTagged(item, "Event") && watched(item.envelope.event) !== null,
          });

          // Subscribed first, so nothing committed between the scan and the feed is missed.
          for (const sessionId of (yield* rt.store.model).sessions.keys()) yield* sync(sessionId);

          yield* Stream.runForEach(live, (item) => {
            const sessionId = Predicate.isTagged(item, "Event")
              ? watched(item.envelope.event)
              : null;

            return sessionId === null ? Effect.void : sync(sessionId);
          });
        })
      ).pipe(Effect.forever),
      rt.engineScope
    );
  });

  return LimitResume.of({ start });
});

export class LimitResume extends Context.Service<
  LimitResume,
  {
    /** Follow the log and keep one timer per Limited session that resumes at its reset. */
    readonly start: Effect.Effect<void>;
  }
>()("polaris/daemon/engine/LimitResume") {
  static readonly layer = Layer.effect(LimitResume, make);
}
