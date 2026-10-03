import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { CID, HOST } from "../engine/constellation.testing.ts";
import { EventStore } from "../store/EventStore.ts";

/** Capture owner graph batches plus actual stable startup Turns from the durable journal. */
export const recordSendbackTrace = Effect.fnUntraced(function* (
  name: string,
  commandContexts?: ReadonlyMap<
    string,
    { offlineSessionIds: ReadonlyArray<string>; commanded: boolean }
  >
) {
  const root = process.env.POLARIS_TRACE_DIR;

  if (root === undefined) return;
  const store = yield* EventStore;
  const model = yield* store.model;
  const graph = model.constellations.get(CID)!.graph;

  const events = [
    ...(yield* store.readConstellationEvents({
      constellationId: CID,
      after: 0,
      upTo: model.sequence,
    })),
  ];

  for (const sessionId of new Set(graph.attempts.map((a) => a.sessionId)))
    events.push(
      ...(yield* store.readEvents({
        after: 0,
        upTo: model.sequence,
        sessionId,
        eventTypes: ["TurnStarted"],
      }))
    );
  events.sort((a, b) => a.sequence - b.sequence);
  const batches: Array<{ hostId: string; events: typeof events }> = [];

  for (const event of events) {
    const previous = batches.at(-1);

    if (previous !== undefined && previous.events.at(-1)!.commandId === event.commandId)
      previous.events.push(event);
    else batches.push({ hostId: HOST, events: [event] });
  }

  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, `sendback-${name}.json`),
    JSON.stringify({
      version: 1,
      ownerHostId: HOST,
      batches: batches.map((b) => ({
        ...b,
        context: commandContexts?.get(b.events[0]!.commandId ?? ""),
        events: b.events.map((e) => e.event),
      })),
    })
  );
});
