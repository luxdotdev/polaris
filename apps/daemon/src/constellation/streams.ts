import {
  type Capability,
  type AttemptId,
  type WorkerLiveness,
  type ConstellationId,
  ConstellationStreamItem,
  type Sequence,
  Sequence as Seq,
} from "@polaris/protocol";
import { Effect, Predicate, Result, Stream } from "effect";
import type { ConstellationBinding } from "../engine/constellation.inputs.ts";
import { eventCapability } from "../store/model.ts";
import { graphEvent } from "../store/constellation.ts";
import type { EventStore } from "../store/EventStore.ts";
import { finding, refusal } from "./decision.ts";
import type { ConstellationLivenessService } from "./liveness.ts";
import { enrichProjections } from "./projections.ts";
import { canRead } from "./service.ts";

const knownEvents =
  (capabilities: ReadonlyArray<Capability>) => (event: import("@polaris/protocol").DomainEvent) => {
    const needed = eventCapability(event);

    return needed !== "constellation.claim-review" || capabilities.includes(needed);
  };

/** Subscribe before the cut, replay at the cut, then send only committed events beyond it. */
export const subscribeConstellation = (
  store: EventStore["Service"],
  binding: ConstellationBinding,
  id: ConstellationId,
  after: Sequence | null,
  capabilities: ReadonlyArray<Capability> = ["constellation.claim-review"],
  liveness?: ConstellationLivenessService
) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const decodes = knownEvents(capabilities);

      const observes = capabilities.includes("constellation.liveness") && liveness !== undefined;
      const liveLiveness = observes ? yield* liveness.subscribe(id) : Stream.empty;

      const subscription = yield* store.subscribe({
        filter: (item) =>
          Predicate.isTagged(item, "Event") &&
          graphEvent(item.envelope.event)?.constellationId === id &&
          decodes(item.envelope.event),
      });

      const model = yield* store.model;
      const record = model.constellations.get(id);

      if (record === undefined)
        return yield* refusal(undefined, [
          finding("E-NOT-FOUND", "The constellation does not exist", "Start it with plan."),
        ]);

      if (!canRead(binding, record))
        return yield* refusal(record, [
          finding(
            "E-AUTHORITY",
            "This session cannot read the constellation",
            "Use the current lead or worker binding."
          ),
        ]);
      const cut = Seq.make(model.sequence);
      const facts = observes ? yield* liveness.read(record) : new Map<AttemptId, WorkerLiveness>();
      const head: Array<ConstellationStreamItem> = [];

      if (after === null || after > cut)
        head.push(
          ConstellationStreamItem.cases.Snapshot.make({
            sequence: cut,
            constellation: record.graph,
            projections: enrichProjections(record, facts),
          })
        );
      else {
        const replay = yield* store
          .readConstellationEvents({ constellationId: id, after, upTo: cut })
          .pipe(
            Effect.catchTag("ServiceError", (error) =>
              Effect.fail(
                refusal(record, [
                  finding("E-STORE", error.message, "Resume the stream from its last sequence."),
                ])
              )
            )
          );

        for (const envelope of replay) {
          const event = graphEvent(envelope.event);

          if (event !== null && decodes(event))
            head.push(
              ConstellationStreamItem.cases.Event.make({
                envelope: {
                  sequence: envelope.sequence,
                  occurredAt: envelope.occurredAt,
                  commandId: envelope.commandId,
                  event,
                },
              })
            );
        }
      }

      head.push(ConstellationStreamItem.cases.Synchronized.make({ sequence: cut }));

      head.push(
        ...[...facts].map(([attemptId, value]) =>
          ConstellationStreamItem.cases.LivenessChanged.make({ attemptId, liveness: value })
        )
      );

      const live = subscription.pipe(
        Stream.filterMap((item) => {
          if (!Predicate.isTagged(item, "Event") || item.envelope.sequence <= cut)
            return Result.failVoid;
          const event = graphEvent(item.envelope.event);

          return event === null
            ? Result.failVoid
            : Result.succeed(
                ConstellationStreamItem.cases.Event.make({
                  envelope: {
                    sequence: item.envelope.sequence,
                    occurredAt: item.envelope.occurredAt,
                    commandId: item.envelope.commandId,
                    event,
                  },
                })
              );
        })
      );

      return Stream.concat(Stream.fromIterable(head), Stream.merge(live, liveLiveness));
    })
  );
