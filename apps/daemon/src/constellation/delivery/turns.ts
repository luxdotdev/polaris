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
import { withWorkerAdmission } from "../../resources/workerAdmission.ts";
import { decideSession } from "../../engine/session.ts";
import { serialInput } from "./boundary.ts";
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
  sessionId: SessionId,
  pendingStartup: boolean = false
) {
  const store = yield* EventStore;

  while (true) {
    const ready = yield* Effect.scoped(
      Effect.gen(function* () {
        const feed = yield* store.subscribe({ sessionId });

        const inspect = Effect.map(store.model, (model) => {
          const record = model.sessions.get(sessionId);

          if (
            record === undefined ||
            record.session.state === "archived" ||
            (pendingStartup && record.session.state === "failed")
          )
            return "gone";

          const turn = newTurn(record.session, "", new Date().toISOString());

          const interruptedStartup =
            pendingStartup &&
            record.session.state === "needs-you" &&
            record.turns.at(-1)?.status === "interrupted" &&
            record.pending.size === 0 &&
            decideSession(record, { type: "turn.send", turn }).rejection === null;

          return interruptedStartup || takesDelivery(record, turn) ? "ready" : "wait";
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

const rejectDelivery = (packet: DeliveryPacket, reason: string) =>
  new CommandRejected({ commandId: CommandId.make(packet.id), reason });

const deliveryEvents = Effect.fnUntraced(function* (
  packet: DeliveryPacket,
  model: ReadModel,
  canSteer: boolean,
  validate: (packet: DeliveryPacket, model: ReadModel) => Effect.Effect<void, CommandRejected>
) {
  yield* validate(packet, model);
  const record = model.sessions.get(packet.sessionId);

  if (record === undefined || record.session.state === "archived")
    return yield* rejectDelivery(packet, "Unavailable worker Session");

  if (Predicate.isTagged(packet.input, "Turn") && packet.input.cause === "recover")
    return yield* rejectDelivery(
      packet,
      "Remote recovery requires verified interrupted Turn facts"
    );
  const working = record.turns.some((t) => t.status === "working");

  if (working && Predicate.isTagged(packet.input, "Turn") && packet.input.cause === "unblock")
    return yield* rejectDelivery(packet, "Worker input is queued");
  const turn = newTurn(record.session, packet.input.text, new Date().toISOString(), packet.id);

  const decision = decideSession(
    record,
    working ? { type: "turn.steer", canSteer } : { type: "turn.send", turn }
  );

  if (decision.rejection !== null || (!working && !takesDelivery(record, turn)))
    return yield* rejectDelivery(packet, "Worker input is queued");

  return decision.events;
});

const commitDelivery = Effect.fnUntraced(function* (
  packet: DeliveryPacket,
  canSteer: boolean,
  validate: (packet: DeliveryPacket, model: ReadModel) => Effect.Effect<void, CommandRejected>
) {
  const store = yield* EventStore;
  const effects = yield* ConstellationSessionEffects;

  const result = yield* store
    .commit({
      recordRejection: false,
      commandId: CommandId.make(packet.id),
      decide: (model) => deliveryEvents(packet, model, canSteer, validate),
    })
    .pipe(
      Effect.catchTag("CommandRejected", (error) =>
        error.reason === "Worker input is queued" ? Effect.succeed(null) : Effect.fail(error)
      )
    );

  if (result === null) return false;

  if (!Predicate.isTagged(result, "Committed")) return true;
  const turn = startedTurn(result.envelopes.map((e) => e.event));

  if (turn !== undefined) yield* effects.runTurn(turn, packet.input.text);
  else yield* effects.steer(packet.sessionId, packet.input.text);

  return true;
});

/** Receipt retries bypass admission; new input pins a slot before taking the Session gate. */
const applyDelivery = Effect.fn("Constellation.applyWorkerDelivery")(function* (
  packet: DeliveryPacket,
  validate: (packet: DeliveryPacket, model: ReadModel) => Effect.Effect<void, CommandRejected>
) {
  const store = yield* EventStore;
  const effects = yield* ConstellationSessionEffects;
  const canSteer = yield* effects.canSteer(packet.sessionId);
  const unblock = Predicate.isTagged(packet.input, "Turn") && packet.input.cause === "unblock";

  while (true) {
    const done = yield* Effect.scoped(
      Effect.gen(function* () {
        const feed = yield* store.subscribe({ sessionId: packet.sessionId });

        if (yield* store.hasCommandReceipt(CommandId.make(packet.id)).pipe(Effect.orDie))
          return true;
        yield* validate(packet, yield* store.model);

        const result = yield* withWorkerAdmission(
          store,
          packet.sessionId,
          serialInput(
            packet.sessionId,
            Effect.uninterruptible(commitDelivery(packet, canSteer, validate))
          ),
          unblock
        );

        if (result === undefined)
          return yield* rejectDelivery(packet, "Worker admission closed while input was queued");

        if (!result) yield* feed.pipe(Stream.take(1), Stream.runDrain);

        return result;
      })
    );

    if (done) return;
  }
});

export const applyWorkerDelivery = applyDelivery;
