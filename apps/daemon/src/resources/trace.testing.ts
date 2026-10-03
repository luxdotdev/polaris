import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Predicate } from "effect";
import { EventStore } from "../store/EventStore.ts";

let nextTrace = 0;

/** Emit the C1-P version-one replay format from real committed Host events. */
export const recordResourceTrace = Effect.gen(function* () {
  const directory = process.env.POLARIS_RESOURCE_TRACE_DIR;

  if (directory === undefined) return;
  const store = yield* EventStore;
  const model = yield* store.model;

  const events = (yield* store.readEvents({
    after: 0,
    upTo: model.sequence,
    sessionId: null,
  })).filter(({ event }) => event._tag.startsWith("Resource"));

  let hostId: string | null = null;

  for (const { event } of events) {
    if (Predicate.isTagged(event, "ResourceDeclared")) {
      hostId = event.resource.hostId;
      break;
    }
  }

  if (hostId === null) return;
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `resources-${process.pid}-${nextTrace++}.json`),
    JSON.stringify({
      version: 1,
      ownerHostId: hostId,
      batches: events.map((envelope) => ({ hostId, events: [envelope.event] })),
    })
  );
});
