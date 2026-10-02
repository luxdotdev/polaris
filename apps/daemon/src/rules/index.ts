/**
 * The Rules layer (CONTEXT.md: Risk Summary): the module's interface. See
 * README.md for how a run works and docs/research/rules-layer.md for why.
 */
import { DomainEvent, LayerRun, type RiskSummaryId } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import { Rules, ServiceError } from "../services.ts";
import { EventStore } from "../store/EventStore.ts";
import type { RulesRequest } from "./run.ts";

export { findingIdentity, secretSeverity } from "./findings.ts";

export type { RulesMode, RulesOutcome, RulesRequest } from "./run.ts";

export const RulesLive = Layer.succeed(
  Rules,
  Rules.of({
    run: Effect.fn("Rules.run")(function* (request) {
      return yield* Effect.tryPromise({
        try: async (signal) => {
          const { runRules } = await import("./run.ts");

          return runRules(request, signal);
        },
        catch: (cause) =>
          new ServiceError({
            service: "Rules",
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
    }),
  })
);

const layerChanged = (summaryId: RiskSummaryId, run: LayerRun) =>
  DomainEvent.cases.RiskSummaryLayerChanged.make({ summaryId, layer: "rules", run });

/**
 * Runs the Rules for a started Risk Summary and records them: the layer
 * `running`, then its Findings and `completed` (with any notes), or `failed`.
 * The Risk Summary's own start and end belong to whoever runs the summary.
 */
export const recordRulesLayer = Effect.fn("recordRulesLayer")(function* (
  summaryId: RiskSummaryId,
  request: RulesRequest
) {
  const store = yield* EventStore;
  const rules = yield* Rules;

  const commit = (events: ReadonlyArray<DomainEvent>) =>
    store.commit({ commandId: null, decide: () => Effect.succeed(events) });

  const failed = (note: string) =>
    commit([layerChanged(summaryId, new LayerRun({ status: "failed", note }))]);

  yield* commit([layerChanged(summaryId, new LayerRun({ status: "running", note: null }))]);

  return yield* rules.run(request).pipe(
    Effect.matchEffect({
      onFailure: (error) => failed(`The rules could not run: ${error.message}`),
      onSuccess: ({ findings, notes, ok }) =>
        ok
          ? commit([
              ...(findings.length > 0
                ? [DomainEvent.cases.RiskFindingsRecorded.make({ summaryId, findings })]
                : []),
              layerChanged(
                summaryId,
                new LayerRun({
                  status: "completed",
                  note: notes.length > 0 ? notes.join(". ") : null,
                })
              ),
            ])
          : failed(notes.join(". ")),
    })
  );
});
