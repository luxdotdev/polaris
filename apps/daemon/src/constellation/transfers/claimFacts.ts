import {
  type Attempt,
  type ConstellationCommand,
  type RemoteWorkerAssignment,
} from "@polaris/protocol";
import { Effect, Predicate } from "effect";
import type { RecordedCheck } from "../../engine/constellation.inputs.ts";
import type { EventStore } from "../../store/EventStore.ts";
import type { ConstellationWorktrees } from "../worktrees.ts";
import { gitOperation, transferError } from "../worktrees.ts";
import { constellationRef } from "../../git/constellationBundles.ts";
import { gitText, resolveCommit } from "../../git/git.ts";
import type { TransferStorage } from "./storage.ts";

export const collectClaimFacts = Effect.fnUntraced(function* (
  assignment: RemoteWorkerAssignment,
  attempt: Attempt,
  command: Extract<ConstellationCommand, { _tag: "WorkerClaim" }>,
  services: {
    store: EventStore["Service"];
    storage: TransferStorage["Service"];
    worktrees: ConstellationWorktrees["Service"];
  }
) {
  if (attempt.state !== "working")
    return yield* transferError("E-SETTLED", "This Attempt already has a Claim");
  const claimProbe = yield* services.worktrees.probeClaim(attempt);

  if (claimProbe.dirtyPaths.length > 0)
    return yield* transferError(
      "E-CLAIM-DIRTY",
      "Commit the worker's uncommitted changes before claiming"
    );

  if (claimProbe.head !== command.claim.head || claimProbe.branch !== command.claim.branch)
    return yield* transferError(
      "E-CLAIM-HEAD",
      "The Claim does not match the assigned branch head"
    );

  if ((yield* services.storage.claimedAttempts).has(attempt.id))
    return yield* transferError("E-CLAIM-QUEUED", "This Attempt already has a durable Claim");
  yield* gitOperation(async () => {
    const ref = constellationRef(assignment.graph.id, attempt.id);
    const head = await resolveCommit(attempt.worktree, ref);
    await gitText(attempt.worktree, ["update-ref", ref, command.claim.head, head ?? ""]);
  });
  const recordedChecks: Array<RecordedCheck> = [];
  const store = services.store;

  for (const receipt of command.claim.receipts) {
    if (
      !Predicate.isTagged(receipt, "Verified") ||
      receipt.item.hostId !== attempt.hostId ||
      receipt.item.sessionId !== attempt.sessionId
    )
      continue;

    const mapError = (error: import("../../services.ts").ServiceError) =>
      transferError("E-STORAGE", error.message, true);

    const items = yield* store
      .readTurnItems({ turnIds: [receipt.item.turnId], upTo: (yield* store.model).sequence })
      .pipe(Effect.mapError(mapError));

    const turns = yield* store
      .readTurns({ sessionId: receipt.item.sessionId, beforeIndex: null, limit: null })
      .pipe(Effect.mapError(mapError));

    const item = items.get(receipt.item.turnId)?.find((i) => i.id === receipt.item.itemId);

    if (turns.some((t) => t.id === receipt.item.turnId) && item !== undefined)
      recordedChecks.push({ reference: receipt.item, item });
  }

  return { claimProbe, recordedChecks };
});
