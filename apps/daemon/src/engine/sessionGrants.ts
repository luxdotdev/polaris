/** Durable Grant Approvals for authenticated Agent Sessions (ADR 0119). */
import {
  ApprovalRequest,
  DomainEvent,
  NotFound,
  NotGranted,
  RequestId,
  type SessionId,
} from "@polaris/protocol";
import { Context, Effect, Layer, Match, Predicate, Stream } from "effect";
import { ServiceError } from "../services.ts";
import { grantActionDescription } from "./grantAction.ts";
import { workingTurn } from "../store/model.ts";
import { EngineRuntime } from "./runtime.ts";
import {
  inStarterChain,
  startLimitRefusal,
  sessionActionAllowed,
  sessionActionGrant,
  type SessionAction,
} from "./sessionGrantPolicy.ts";

export class SessionGrants extends Context.Service<
  SessionGrants,
  {
    readonly authorize: (
      sessionId: SessionId,
      input: SessionAction
    ) => Effect.Effect<void, NotGranted | NotFound>;
    readonly startLimit: Effect.Effect<number>;
    readonly setStartLimit: (
      sessionId: SessionId | null,
      limit: number
    ) => Effect.Effect<void, ServiceError | NotFound | NotGranted>;
  }
>()("polaris/daemon/engine/SessionGrants") {
  static readonly layer = Layer.effect(
    SessionGrants,
    Effect.gen(function* () {
      const rt = yield* EngineRuntime;

      const denied = (what: string, reason: string) =>
        new NotGranted({ what, needed: null, reason });

      const authorize = Effect.fnUntraced(function* (sessionId: SessionId, input: SessionAction) {
        const model = yield* rt.store.model;

        if (!model.sessions.has(sessionId))
          return yield* new NotFound({ what: "session", id: sessionId });

        if (sessionActionAllowed(model, sessionId, input)) return;
        const needed = sessionActionGrant(input);
        const what = input.rpc === "dispatch" ? `dispatch:${input.command?._tag ?? ""}` : input.rpc;

        if (needed !== "start" && needed !== "turn" && needed !== "settings")
          return yield* denied(
            what,
            "Only the user can perform this action; session Grants cannot allow it."
          );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const commits = yield* rt.store.subscribe({ sessionId });
            const record = (yield* rt.store.model).sessions.get(sessionId);
            const turn = record === undefined ? undefined : workingTurn(record);

            if (turn === undefined || record === undefined)
              return yield* denied(
                what,
                "A Grant Approval needs a Turn in flight. Use the session's tools during a Turn."
              );

            const target =
              input.command !== undefined && "sessionId" in input.command
                ? input.command.sessionId
                : null;

            const requestId = RequestId.make(`grant-${crypto.randomUUID()}`);

            const request = new ApprovalRequest({
              id: requestId,
              sessionId,
              turnId: turn.id,
              kind: "grant",
              title: `Allow this session to ${Match.value(needed).pipe(
                Match.when("settings", () => "change settings"),
                Match.when("start", () => "start a session"),
                Match.orElse(() => "send or stop a turn")
              )}?`,
              detail: grantActionDescription(model, input),
              options: [],
              questions: [],
              openedAt: yield* rt.now,
              grant: {
                kind: needed,
                action: what,
                targetSessionId: target,
                rememberable:
                  needed !== "turn" ||
                  (target !== null && inStarterChain(model, sessionId, target)),
              },
            });

            const opened = yield* rt.signal(sessionId, {
              type: "grant.approvalRequested",
              request,
            });

            const pending = Effect.map(
              rt.store.model,
              (m) => m.sessions.get(sessionId)?.pending.has(requestId) ?? false
            );

            if (opened.sequence === null)
              return yield* denied(what, "The Grant Approval could not be opened.");
            yield* Effect.gen(function* () {
              if (yield* pending)
                yield* commits.pipe(
                  Stream.mapEffect(() => pending),
                  Stream.takeUntil((still) => !still),
                  Stream.runDrain
                );
              const now = yield* rt.store.model;

              const events = yield* rt.store.readEvents({
                after: opened.sequence!,
                upTo: now.sequence,
                sessionId,
                eventTypes: ["ApprovalResolved"],
              });

              const allowed = events.some(
                ({ event }) =>
                  Predicate.isTagged(event, "ApprovalResolved") &&
                  event.requestId === requestId &&
                  Predicate.isTagged(event.decision, "Allow")
              );

              if (!allowed) return yield* denied(what, "The user did not allow this action.");
            }).pipe(
              Effect.ensuring(
                Effect.ignore(
                  rt.signal(sessionId, {
                    type: "harness.approvalWithdrawn",
                    requestId,
                    withdrawnBy: "daemon",
                    reason: "The agent stopped waiting",
                  })
                )
              )
            );
          })
        ).pipe(Effect.catchTag("ServiceError", (error) => Effect.die(error)));
      });

      return SessionGrants.of({
        authorize,
        startLimit: Effect.map(rt.store.model, (model) => model.sessionStartLimit ?? 5),
        setStartLimit: Effect.fnUntraced(function* (sessionId, limit) {
          if (!Number.isSafeInteger(limit) || limit < 0)
            return yield* new ServiceError({
              service: "sessionGrants",
              message: "The start limit must be a non-negative integer.",
            });
          yield* rt.store.commit({
            commandId: null,
            decide: (model): Effect.Effect<ReadonlyArray<DomainEvent>, NotFound | NotGranted> => {
              if (sessionId !== null && !model.sessions.has(sessionId))
                return Effect.fail(new NotFound({ what: "session", id: sessionId }));

              const refusal = startLimitRefusal(model, sessionId, limit);

              if (refusal !== null)
                return Effect.fail(
                  new NotGranted({ what: "sessions.startLimit", needed: null, reason: refusal })
                );

              return Effect.succeed([
                sessionId === null
                  ? DomainEvent.cases.HostSessionStartLimitChanged.make({ limit })
                  : DomainEvent.cases.SessionStartLimitChanged.make({ sessionId, limit }),
              ]);
            },
          });
        }),
      });
    })
  );
}
