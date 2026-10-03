import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HostId } from "@polaris/protocol";
import { Effect, Predicate } from "effect";
import { CID, HOST } from "../../engine/constellation.testing.ts";
import type { EventStore } from "../../store/EventStore.ts";
import { WORKER } from "../delivery/testing.ts";

export const recordRemoteBlockTrace = Effect.fnUntraced(function* (
  owner: EventStore["Service"],
  worker: EventStore["Service"],
  remoteId: HostId
) {
  const dir = process.env.POLARIS_TRACE_DIR;

  if (dir === undefined) return;

  const complete = yield* owner.readConstellationEvents({
    constellationId: CID,
    after: 0,
    upTo: (yield* owner.model).sequence,
  });

  const turns = yield* worker.readEvents({
    after: 0,
    upTo: (yield* worker.model).sequence,
    sessionId: WORKER,
  });

  const batches = [...Map.groupBy(complete, (e) => e.commandId ?? "acknowledgement").values()];
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "constellation-remote-block-boundary.json"),
    JSON.stringify({
      version: 1,
      ownerHostId: HOST,
      batches: batches.flatMap((batch) => [
        ...(batch.some((e) => Predicate.isTagged(e.event, "AttemptUnblocked"))
          ? [{ hostId: remoteId, events: turns.map((e) => e.event) }]
          : []),
        { hostId: HOST, events: batch.map((e) => e.event) },
      ]),
    })
  );
});
