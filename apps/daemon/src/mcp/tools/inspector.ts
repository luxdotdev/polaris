import { CommandId, ConstellationCommand, InspectionVerdict } from "@polaris/protocol";
import { Effect, Schema } from "effect";
import { type McpBinding, sessionBinding } from "../binding.ts";
import { rejection, toolFactory, type BoundTool, type ConstellationCommands } from "./shared.ts";

/** The Inspector's whole catalog: one verdict on the Claim it was started for (ADR 0119). */
export const inspectorTools = (
  bound: Extract<McpBinding, { _tag: "Inspector" }>,
  commands: ConstellationCommands
): ReadonlyArray<BoundTool> => {
  // A refusal is never given the graph for context: the Inspector may not read it.
  const define = toolFactory(() =>
    Effect.fail(rejection("E-AUTHORITY", "An Inspector does not read status", "Record a verdict."))
  );

  return [
    define(
      "verdict",
      "Record your verdict on the claim you were given, once. approve passes it on; send_back returns it to the worker and needs a reason naming what must change. A verdict on a claim that was replaced or already reviewed is refused; stop then.",
      Schema.Struct({ verdict: InspectionVerdict, reason: Schema.String }),
      (input) =>
        commands.command(
          sessionBinding(bound),
          CommandId.make(crypto.randomUUID()),
          ConstellationCommand.cases.Inspect.make({
            ...input,
            constellationId: bound.constellationId,
            attemptId: bound.attemptId,
            inspectionId: bound.inspectionId,
          })
        ),
      { summary: "Verdict recorded.", next: "End this Turn; the Inspection is over." }
    ),
  ];
};
