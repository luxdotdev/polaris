import { CommandId, ReviewAction, WorkerPlacement } from "@polaris/protocol";
import { Effect } from "effect";
import { C, CID, report } from "../../engine/constellation.testing.ts";
import { EventStore } from "../../store/EventStore.ts";
import { Constellations } from "../service.ts";

export const sendBack = Effect.fnUntraced(function* () {
  const graphs = yield* Constellations;
  const store = yield* EventStore;
  const attempt = (yield* store.model).constellations.get(CID)!.graph.attempts.at(-1)!;
  yield* graphs.command(
    { kind: "session", sessionId: attempt.sessionId },
    CommandId.make("claim"),
    C.WorkerClaim.make({ constellationId: CID, attemptId: attempt.id, claim: report() })
  );
  const review = (yield* store.model).constellations.get(CID)!.graph.attempts.at(-1)!;
  yield* graphs.command(
    { kind: "user" },
    CommandId.make("busy-sendback"),
    C.Review.make({
      constellationId: CID,
      attemptId: review.id,
      revision: review.revision,
      action: ReviewAction.cases.SendBack.make({
        reason: "Finish the cleanup",
        worker: WorkerPlacement.cases.Existing.make({ sessionId: attempt.sessionId }),
      }),
    })
  );

  return (yield* store.model).constellations.get(CID)!.graph.attempts.at(-1)!;
});
