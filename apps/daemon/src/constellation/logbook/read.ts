/** Reading a Logbook from the store: one page, or a feed of pages as it grows. */
import type { ConstellationFinding, LogbookPage } from "@polaris/protocol";
import { Effect, Predicate, Stream } from "effect";
import type { ConstellationBinding } from "../../engine/constellation.inputs.ts";
import { type ConstellationRecord, graphEvent } from "../../store/constellation.ts";
import type { EventStore } from "../../store/EventStore.ts";
import { finding, refusal } from "../decision.ts";
import { foldLogbook, type LogbookEvent, type LogbookFold, stepLogbook } from "./fold.ts";
import { logbookPage, logbookRefusal, type LogbookScope } from "./page.ts";

type Store = EventStore["Service"];

/** A refused reader gets the finding alone: the graph in a refusal would show what it may not read. */
const denied = (refused: ConstellationFinding) => refusal(undefined, [refused]);

const admit = (
  binding: ConstellationBinding,
  record: ConstellationRecord | undefined,
  scope: LogbookScope
) => {
  if (record === undefined)
    return Effect.fail(
      refusal(undefined, [
        finding("E-NOT-FOUND", "The constellation does not exist", "Start it with plan."),
      ])
    );

  const refused = logbookRefusal(binding, record, scope);

  return refused === null ? Effect.succeed(record) : Effect.fail(denied(refused));
};

/** The whole log folded at the store's current sequence, after the read is admitted. */
const folded = Effect.fn("Logbook.fold")(function* (
  store: Store,
  binding: ConstellationBinding,
  scope: LogbookScope
) {
  const model = yield* store.model;
  const record = yield* admit(binding, model.constellations.get(scope.constellationId), scope);

  const envelopes = yield* store
    .readConstellationEvents({
      constellationId: scope.constellationId,
      after: 0,
      upTo: model.sequence,
    })
    .pipe(
      Effect.mapError((error) =>
        refusal(record, [finding("E-STORE", error.message, "Read the Logbook again.")])
      )
    );

  const events = envelopes.flatMap((envelope): ReadonlyArray<LogbookEvent> => {
    const event = graphEvent(envelope.event);

    return event === null
      ? []
      : [{ sequence: envelope.sequence, occurredAt: envelope.occurredAt, event }];
  });

  return { ...foldLogbook(events), cut: model.sequence, sessions: model.sessions };
});

/** One page: every Attempt boundary, and the entries after `scope.since`. */
export const readLogbook = Effect.fn("Logbook.read")(function* (
  store: Store,
  binding: ConstellationBinding,
  scope: LogbookScope
) {
  const { fold, entries, cut, sessions } = yield* folded(store, binding, scope);

  return logbookPage(fold, entries, scope, cut, sessions);
});

/** What a boundary list looks like, to tell whether a later one differs. */
const boundaryKey = (page: LogbookPage) =>
  page.attempts.map((a) => `${a.attemptId}:${a.state}:${a.endedAt}`).join("|");

/**
 * The feed: subscribe before the cut, send the read's page, then one page per committed event
 * that adds an entry in scope or changes a boundary. It ends refused once the reader loses access.
 */
export const subscribeLogbook = (
  store: Store,
  binding: ConstellationBinding,
  scope: LogbookScope
) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const subscription = yield* store.subscribe({
        filter: (item) =>
          Predicate.isTagged(item, "Event") &&
          graphEvent(item.envelope.event)?.constellationId === scope.constellationId,
      });

      const start = yield* folded(store, binding, scope);
      const first = logbookPage(start.fold, start.entries, scope, start.cut, start.sessions);

      // One consumer drains this stream in order, so the fold it carries is kept here.
      let fold: LogbookFold = start.fold;
      let boundaries = boundaryKey(first);

      const next = Effect.fn("Logbook.next")(function* (envelope: LogbookEvent) {
        const step = stepLogbook(fold, envelope);
        fold = step.fold;

        const record = fold.record;
        const refused = record === undefined ? null : logbookRefusal(binding, record, scope);

        if (refused !== null) return yield* denied(refused);

        const model = yield* store.model;

        // Only what this event added, and still nothing at or before a `since` ahead of the log.
        const page = logbookPage(fold, step.entries, scope, envelope.sequence, model.sessions);

        const key = boundaryKey(page);

        if (page.entries.length === 0 && key === boundaries) return [];
        boundaries = key;

        return [page];
      });

      const live = subscription.pipe(
        Stream.mapEffect((item) => {
          if (!Predicate.isTagged(item, "Event") || item.envelope.sequence <= start.cut)
            return Effect.succeed<ReadonlyArray<LogbookPage>>([]);

          const event = graphEvent(item.envelope.event);

          return event === null
            ? Effect.succeed<ReadonlyArray<LogbookPage>>([])
            : next({
                sequence: item.envelope.sequence,
                occurredAt: item.envelope.occurredAt,
                event,
              });
        }),
        Stream.flatMap((pages) => Stream.fromIterable(pages))
      );

      return Stream.concat(Stream.make(first), live);
    })
  );
