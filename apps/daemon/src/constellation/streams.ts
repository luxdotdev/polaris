import {
  type AttemptId,
  AttemptProgress,
  ConstellationProposal,
  type WorkerLiveness,
  type ConstellationId,
  ConstellationStreamItem,
  type Sequence,
  Sequence as Seq,
} from "@polaris/protocol";
import { Effect, Predicate, Result, Stream } from "effect";
import type { ConstellationBinding } from "../engine/constellation.inputs.ts";
import {
  type ConstellationRecord,
  graphEvent,
  pendingMessage,
  stampKey,
} from "../store/constellation.ts";
import type { EventStore } from "../store/EventStore.ts";
import { finding, refusal } from "./decision.ts";
import type { ConstellationLivenessService } from "./liveness.ts";
import { enrichProjections } from "./projections.ts";
import { canRead } from "./service.ts";

/** The owner's journal a fresh subscriber needs besides the graph. */
const journalOf = (record: ConstellationRecord) => ({
  proposals: [...record.proposals].map(
    ([proposalId, p]) =>
      new ConstellationProposal({
        proposalId,
        by: p.by,
        task: p.task,
        at: record.stamps.get(stampKey("proposal", proposalId)) ?? record.graph.updatedAt,
      })
  ),
  progress: [...record.progress.values()].map(
    (e) =>
      new AttemptProgress({
        attemptId: e.attemptId,
        note: e.note,
        completed: e.completed,
        total: e.total,
        at: record.stamps.get(stampKey("progress", e.attemptId)) ?? record.graph.updatedAt,
      })
  ),
  messages: [...record.messages.values()].map((m) => pendingMessage(record, m)),
  digests: record.digests,
  handovers: record.handovers,
});

/** Subscribe before the cut, replay at the cut, then send only committed events beyond it. */
export const subscribeConstellation = (
  store: EventStore["Service"],
  binding: ConstellationBinding,
  id: ConstellationId,
  after: Sequence | null,
  liveness?: ConstellationLivenessService
) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const liveLiveness = liveness === undefined ? Stream.empty : yield* liveness.subscribe(id);

      const subscription = yield* store.subscribe({
        filter: (item) =>
          Predicate.isTagged(item, "Event") &&
          graphEvent(item.envelope.event)?.constellationId === id,
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

      const facts =
        liveness === undefined
          ? new Map<AttemptId, WorkerLiveness>()
          : yield* liveness.read(record);

      const head: Array<ConstellationStreamItem> = [];

      if (after === null || after > cut)
        head.push(
          ConstellationStreamItem.cases.Snapshot.make({
            sequence: cut,
            constellation: record.graph,
            projections: enrichProjections(record, facts),
            ...journalOf(record),
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

          if (event !== null)
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
