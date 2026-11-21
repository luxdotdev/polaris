import type { HostId, ToolCallReference } from "@polaris/protocol";
import { Effect } from "effect";
import type { RecordedCheck } from "../engine/constellation.inputs.ts";
import type { EventStore } from "../store/EventStore.ts";
import type { ReadModel } from "../store/model.ts";

/** The items this Host recorded for `refs`, as of `model`; a reference it can't find is left out. */
export const recordedChecks = Effect.fnUntraced(function* (
  store: EventStore["Service"],
  hostId: HostId,
  model: ReadModel,
  refs: ReadonlyArray<ToolCallReference>
) {
  const found: Array<RecordedCheck> = [];

  for (const ref of refs) {
    if (ref.hostId !== hostId || !model.sessions.has(ref.sessionId)) continue;

    const turn = (yield* store.readTurns({
      sessionId: ref.sessionId,
      beforeIndex: null,
      limit: null,
    })).find((t) => t.id === ref.turnId);

    if (turn === undefined) continue;

    const items = yield* store.readTurnItems({ turnIds: [ref.turnId], upTo: model.sequence });
    const item = items.get(ref.turnId)?.find((i) => i.id === ref.itemId);

    if (item !== undefined) found.push({ reference: ref, item });
  }

  return found;
});
