import {
  type AgentSession,
  CommandId,
  CommandRejected,
  type DomainEvent,
  SessionId,
  Turn,
  TurnId,
} from "@polaris/protocol";
import { Effect, Predicate, Stream } from "effect";
import { decideSession } from "../../engine/session.ts";
import { EventStore } from "../../store/EventStore.ts";
import type { ReadModel, SessionRecord } from "../../store/model.ts";
import { ConstellationSessionEffects, type DeliveryPacket } from "./inputs.ts";

export const newTurn = (
  session: AgentSession,
  text: string,
  at: string,
  id: string = crypto.randomUUID()
) =>
  new Turn({
    id: TurnId.make(id),
    sessionId: session.id,
    index: session.turnCount,
    prompt: text,
    attachments: [],
    model: session.model,
    effort: session.effort,
    status: "working",
    checkpointBefore: null,
    checkpointAfter: null,
    startedAt: at,
    endedAt: null,
  });

export const startedTurn = (events: ReadonlyArray<DomainEvent>) =>
  events.find((e) => Predicate.isTagged(e, "TurnStarted"))?.turn;

/** Delivery readiness uses the Session machine and excludes infrastructure failures from auto-wake. */
export const takesDelivery = (record: SessionRecord | undefined, turn: Turn) =>
  record !== undefined &&
  (record.session.state === "idle" || record.session.state === "dormant") &&
  decideSession(record, { type: "turn.send", turn }).rejection === null;

export const waitForBoundary = Effect.fn("Constellation.waitForBoundary")(function* (
  sessionId: SessionId
) {
  const store = yield* EventStore;

  while (true) {
    const finished = yield* Effect.scoped(
      Effect.gen(function* () {
        const feed = yield* store.subscribe({ sessionId });

        const idle = (record: SessionRecord | undefined) =>
          record === undefined || !record.turns.some((t) => t.status === "working");

        if (idle((yield* store.model).sessions.get(sessionId))) return true;
        yield* feed.pipe(
          Stream.takeUntilEffect(() =>
            Effect.map(store.model, (m) => idle(m.sessions.get(sessionId)))
          ),
          Stream.runDrain
        );

        return idle((yield* store.model).sessions.get(sessionId));
      })
    );

    if (finished) return;
  }
});

/** Existing Sessions retain approvals and terminal ownership until their machine accepts a Turn. */
export const waitForDeliveryReady = Effect.fn("Constellation.waitForDeliveryReady")(function* (
  sessionId: SessionId
) {
  const store = yield* EventStore;

  while (true) {
    const ready = yield* Effect.scoped(
      Effect.gen(function* () {
        const feed = yield* store.subscribe({ sessionId });

        const inspect = Effect.map(store.model, (model) => {
          const record = model.sessions.get(sessionId);

          if (record === undefined || record.session.state === "archived") return "gone";

          return takesDelivery(record, newTurn(record.session, "", new Date().toISOString()))
            ? "ready"
            : "wait";
        });

        const state = yield* inspect;

        if (state !== "wait") return state;
        yield* feed.pipe(
          Stream.takeUntilEffect(() => Effect.map(inspect, (state) => state !== "wait")),
          Stream.runDrain
        );

        return yield* inspect;
      })
    );

    if (ready !== "wait") return ready === "ready";
  }
});

/** Receipt lookup inside commit precedes state checks, including retries after an Attempt ends. */
export const applyWorkerDelivery = Effect.fn("Constellation.applyWorkerDelivery")(function* (
  packet: DeliveryPacket,
  validate: (packet: DeliveryPacket, model: ReadModel) => Effect.Effect<void, CommandRejected>
) {
  const store = yield* EventStore;
  const effects = yield* ConstellationSessionEffects;
  const canSteer = yield* effects.canSteer(packet.sessionId);

  while (true) {
    const done = yield* Effect.scoped(
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const feed = yield* store.subscribe({ sessionId: packet.sessionId });

          const result = yield* store
            .commit({
              recordRejection: false,
              commandId: CommandId.make(packet.id),
              decide: (model) =>
                Effect.gen(function* () {
                  yield* validate(packet, model);
                  const record = model.sessions.get(packet.sessionId);

                  if (record === undefined || record.session.state === "archived")
                    return yield* new CommandRejected({
                      commandId: CommandId.make(packet.id),
                      reason: "Unavailable worker Session",
                    });

                  if (Predicate.isTagged(packet.input, "Turn") && packet.input.cause === "recover")
                    return yield* new CommandRejected({
                      commandId: CommandId.make(packet.id),
                      reason: "Remote recovery requires verified interrupted Turn facts",
                    });
                  const working = record.turns.some((t) => t.status === "working");

                  if (
                    working &&
                    Predicate.isTagged(packet.input, "Turn") &&
                    packet.input.cause === "unblock"
                  )
                    return yield* new CommandRejected({
                      commandId: CommandId.make(packet.id),
                      reason: "Worker input is queued",
                    });

                  const turn = newTurn(
                    record.session,
                    packet.input.text,
                    new Date().toISOString(),
                    packet.id
                  );

                  const decision = decideSession(
                    record,
                    working ? { type: "turn.steer", canSteer } : { type: "turn.send", turn }
                  );

                  if (decision.rejection !== null || (!working && !takesDelivery(record, turn)))
                    return yield* new CommandRejected({
                      commandId: CommandId.make(packet.id),
                      reason: "Worker input is queued",
                    });

                  return decision.events;
                }),
            })
            .pipe(
              Effect.catchTag("CommandRejected", (error) =>
                error.reason === "Worker input is queued"
                  ? Effect.succeed(null)
                  : Effect.fail(error)
              )
            );

          if (result === null) {
            yield* restore(feed.pipe(Stream.take(1), Stream.runDrain));

            return false;
          }

          if (!Predicate.isTagged(result, "Committed")) return true;
          const turn = startedTurn(result.envelopes.map((e) => e.event));

          if (turn !== undefined) yield* effects.runTurn(turn, packet.input.text);
          else yield* effects.steer(packet.sessionId, packet.input.text);

          return true;
        })
      )
    );

    if (done) return;
  }
});
