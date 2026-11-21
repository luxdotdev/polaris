/**
 * Committing an Inspector's verdict: what the runtime prepares for it, and what the Inspector
 * is told. A verdict reuses the review path: a SendBack's worker, or an Accept's merge.
 */
import {
  type CommandId,
  ConstellationCommand,
  ConstellationRejected,
  ConstellationResult,
  inspecting,
  ReviewAction,
  type Sequence,
  WorkerPlacement,
} from "@polaris/protocol";
import { Effect } from "effect";
import type { ConstellationBinding, GraphCommand } from "../../engine/constellation.inputs.ts";
import type { ReadModel } from "../../store/model.ts";
import type { ConstellationPreparation, ConstellationRuntimeService } from "../runtime.ts";

export type VerdictPreparation = ConstellationPreparation & {
  readonly inspectorMerge?: { readonly refusal: string | null };
};

const nothing: VerdictPreparation = {
  attempts: [],
  newLeadSessionId: null,
  claimProbe: null,
  recordedChecks: [],
};

/**
 * Prepare as the Lead's own review would: the same worker for a send-back, the same merge for a
 * granted approval. A merge the Daemon refuses is carried to the decider, never raised.
 */
export const prepareVerdict = Effect.fnUntraced(function* (
  runtime: ConstellationRuntimeService,
  binding: ConstellationBinding,
  input: GraphCommand<"Inspect">,
  model: ReadModel,
  commandId: CommandId
): Effect.fn.Return<VerdictPreparation, ConstellationRejected> {
  const attempt = model.constellations
    .get(input.constellationId)
    ?.graph.attempts.find((a) => a.id === input.attemptId);

  const inspection = attempt?.inspection;
  const claim = attempt?.claim;

  // Only the pending Inspection's own Inspector prepares anything; the decider refuses the rest.
  if (
    attempt === undefined ||
    inspection == null ||
    claim == null ||
    !inspecting(attempt) ||
    inspection.id !== input.inspectionId ||
    binding.kind !== "session" ||
    binding.sessionId !== inspection.sessionId
  )
    return nothing;

  const review = (action: ReviewAction) =>
    runtime.prepare(
      binding,
      ConstellationCommand.cases.Review.make({
        constellationId: input.constellationId,
        attemptId: attempt.id,
        revision: attempt.revision,
        action,
      }),
      model,
      commandId
    );

  if (input.verdict === "send_back")
    return input.reason.trim() === ""
      ? nothing
      : yield* review(
          ReviewAction.cases.SendBack.make({
            reason: input.reason,
            worker: WorkerPlacement.cases.Existing.make({ sessionId: attempt.sessionId }),
            mergeConflictBase: null,
          })
        );

  if (!inspection.accept) return nothing;

  return yield* review(
    ReviewAction.cases.Accept.make({ mergedHead: claim.head, receipts: [] })
  ).pipe(
    Effect.map((prepared): VerdictPreparation => ({
      ...prepared,
      inspectorMerge: { refusal: null },
    })),
    Effect.catchTag("ConstellationRejected", (refused) =>
      Effect.succeed<VerdictPreparation>({
        ...nothing,
        inspectorMerge: { refusal: refused.findings.map((f) => f.message).join("; ") },
      })
    )
  );
});

/** An Inspector is refused with the findings alone: the graph is not its to read. */
export const graphFree = (refused: ConstellationRejected) =>
  new ConstellationRejected({ findings: refused.findings, graph: null, revision: 0 });

/** What a recorded verdict answers: no graph, no status outline. */
export const verdictResult = (revision: number, sequence: Sequence | null) =>
  new ConstellationResult({
    summary: "Verdict recorded.",
    next: "End this Turn; the Inspection is over.",
    revision,
    sequence,
    constellation: null,
    projections: [],
    proposals: [],
  });
