/**
 * Host and session streams. Each subscribes to the live hub first, then takes
 * the model's sequence as the cut: a snapshot (or a replay of the events after
 * the Client's sequence) up to the cut, `Synchronized`, then live items after it.
 */
import {
  HostStreamItem,
  NotFound,
  Sequence,
  type SessionId,
  SessionStreamItem,
  SessionSummary,
  TurnDetail,
} from "@polaris/protocol";
import { Context, Effect, Layer, Predicate, Result, Stream } from "effect";
import type { LiveItem } from "../store/EventStore.ts";
import { isHostStreamEvent, lastTurn, type SessionRecord } from "../store/model.ts";
import { EngineRuntime } from "./runtime.ts";

export interface SessionSubscription {
  readonly sessionId: SessionId;
  readonly afterSequence: Sequence | null;
  readonly turnLimit: number | null;
  /** Send `ItemProgress` (the Client announced `session.live-items`). Default false. */
  readonly liveItems?: boolean;
}

const summaryOf = (record: SessionRecord) =>
  new SessionSummary({
    session: record.session,
    pendingApprovals: [...record.pending.values()],
    lastTurnPreview: lastTurn(record)?.prompt.slice(0, 140) ?? null,
  });

const isHostItem = (item: LiveItem) =>
  Predicate.isTagged(item, "Event") && isHostStreamEvent(item.envelope.event);

const withoutProgress = (item: LiveItem) => !Predicate.isTagged(item, "ItemProgress");

const make = (rt: EngineRuntime["Service"]): Streams["Service"] => {
  const { store } = rt;

  const subscribeHost = (afterSequence: Sequence | null): Stream.Stream<HostStreamItem> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* store.subscribe({ filter: isHostItem });
        const model = yield* store.model;
        const cut = Sequence.make(model.sequence);
        const head: Array<HostStreamItem> = [];

        if (afterSequence === null || afterSequence > cut) {
          head.push(
            HostStreamItem.cases.Snapshot.make({
              sequence: cut,
              workspaces: [...model.workspaces.values()],
              worktrees: [...model.worktrees.values()],
              sessions: [...model.sessions.values()].map(summaryOf),
            })
          );
        } else {
          const events = yield* store.readEvents({
            after: afterSequence,
            upTo: cut,
            sessionId: null,
          });

          for (const envelope of events) head.push(HostStreamItem.cases.Event.make({ envelope }));
        }

        head.push(HostStreamItem.cases.Synchronized.make({ sequence: cut }));

        const liveItems = subscription.pipe(
          Stream.filterMap((item) =>
            Predicate.isTagged(item, "Event") && item.envelope.sequence > cut
              ? Result.succeed(HostStreamItem.cases.Event.make({ envelope: item.envelope }))
              : Result.failVoid
          )
        );

        return Stream.concat(Stream.fromIterable(head), liveItems);
      }).pipe(Effect.orDie)
    );

  /** Recent Turns come from the model (consistent with the cut); older, finished ones from SQL. */
  const sessionSnapshot = (record: SessionRecord, cut: Sequence, turnLimit: number | null) =>
    Effect.gen(function* () {
      const total = record.session.turnCount;
      const wanted = turnLimit === null ? total : Math.min(turnLimit, total);
      const recent = record.turns.slice(Math.max(0, record.turns.length - wanted));

      const older =
        wanted > recent.length
          ? yield* store.readTurns({
              sessionId: record.session.id,
              beforeIndex: recent[0]?.index ?? total,
              limit: wanted - recent.length,
            })
          : [];

      const turns = [...older, ...recent];
      const items = yield* store.readTurnItems({ turnIds: turns.map((t) => t.id), upTo: cut });

      return SessionStreamItem.cases.Snapshot.make({
        sequence: cut,
        session: record.session,
        turns: turns.map(
          (turn) => new TurnDetail({ turn, items: [...(items.get(turn.id) ?? [])] })
        ),
        pendingApprovals: [...record.pending.values()],
      });
    }).pipe(Effect.orDie);

  // One stage rather than a filter and a map: this runs for every Delta.
  const liveSessionItem =
    (cut: Sequence) =>
    (item: LiveItem): Result.Result<SessionStreamItem, void> => {
      if (Predicate.isTagged(item, "Event")) {
        return item.envelope.sequence > cut
          ? Result.succeed(SessionStreamItem.cases.Event.make({ envelope: item.envelope }))
          : Result.failVoid;
      }

      const { sessionId: _, ...ephemeral } = item;

      return Result.succeed(ephemeral);
    };

  const subscribeSession = (
    options: SessionSubscription
  ): Stream.Stream<SessionStreamItem, NotFound> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const { sessionId, afterSequence } = options;
        const withProgress = options.liveItems === true;

        const subscription = yield* store.subscribe(
          withProgress ? { sessionId } : { sessionId, filter: withoutProgress }
        );

        const model = yield* store.model;
        const record = model.sessions.get(sessionId);

        if (record === undefined) {
          return yield* new NotFound({ what: "session", id: sessionId });
        }

        const cut = Sequence.make(model.sequence);
        const head: Array<SessionStreamItem> = [];

        if (afterSequence === null || afterSequence > cut) {
          head.push(yield* sessionSnapshot(record, cut, options.turnLimit));
        } else {
          const events = yield* store
            .readEvents({ after: afterSequence, upTo: cut, sessionId })
            .pipe(Effect.orDie);

          for (const envelope of events)
            head.push(SessionStreamItem.cases.Event.make({ envelope }));
        }

        head.push(SessionStreamItem.cases.Synchronized.make({ sequence: cut }));

        // Items still running, so a Client that subscribes mid-Turn sees them at once.
        if (withProgress) {
          for (const { turnId, item } of rt.progress.get(sessionId)?.values() ?? []) {
            head.push(SessionStreamItem.cases.ItemProgress.make({ turnId, item }));
          }
        }

        const liveItems = subscription.pipe(Stream.filterMap(liveSessionItem(cut)));

        return Stream.concat(Stream.fromIterable(head), liveItems);
      })
    );

  return { subscribeHost, subscribeSession };
};

export class Streams extends Context.Service<
  Streams,
  {
    readonly subscribeHost: (afterSequence: Sequence | null) => Stream.Stream<HostStreamItem>;
    readonly subscribeSession: (
      options: SessionSubscription
    ) => Stream.Stream<SessionStreamItem, NotFound>;
  }
>()("polaris/daemon/engine/Streams") {
  static readonly layer = Layer.effect(
    Streams,
    Effect.gen(function* () {
      return make(yield* EngineRuntime);
    })
  );
}
