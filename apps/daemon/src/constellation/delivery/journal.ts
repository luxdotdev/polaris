import { ConstellationSettings, type ConstellationId } from "@polaris/protocol";
import { Effect } from "effect";
import type { ConstellationContext } from "../../engine/constellation.inputs.ts";
import type { ConstellationRecord } from "../../store/constellation.ts";
import { EventStore } from "../../store/EventStore.ts";
import { decideConstellationJournal, type ConstellationJournalInput } from "../journal.ts";
import { ConstellationOwner } from "../runtime.ts";

export const journalContext = (record: ConstellationRecord, now: string): ConstellationContext => ({
  binding: { kind: "user" },
  hostId: record.graph.hostId,
  now,
  attempts: [],
  newLeadSessionId: null,
  claimProbe: null,
  recordedChecks: [],
  occupiedSessions: new Set(),
  offlineSessionIds: new Set(
    record.graph.attempts.filter((a) => record.stale.has(a.id)).map((a) => a.sessionId)
  ),
  commanded: false,
  resourceHolders: [],
  defaults: ConstellationSettings.make({}),
});

export const commitJournal = Effect.fn("Constellation.commitJournal")(function* (
  id: ConstellationId,
  input: ConstellationJournalInput
) {
  const store = yield* EventStore;
  const hostId = yield* ConstellationOwner;

  return yield* store.commit({
    commandId: null,
    decide: (model) => {
      const record = model.constellations.get(id);

      if (record === undefined) return Effect.succeed([]);

      const decision = decideConstellationJournal(record, input, {
        ...journalContext(record, new Date().toISOString()),
        hostId,
      });

      return decision.rejection === null
        ? Effect.succeed(decision.events)
        : Effect.fail(decision.rejection);
    },
  });
});
