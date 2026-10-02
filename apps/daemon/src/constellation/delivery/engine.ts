import { Command, CommandId } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import { Engine } from "../../engine/Engine.ts";
import { ConstellationSessionEffects } from "./inputs.ts";

/** Use the existing Engine's supervisor and serialization; delivery never creates a second Harness runtime. */
export const engineDeliveryLayer = Layer.effect(
  ConstellationSessionEffects,
  Effect.gen(function* () {
    const engine = yield* Engine;

    return {
      runTurn: engine.runCommittedTurn,
      canSteer: engine.canSteerSession,
      steer: engine.steerCommittedInput,
      interrupt: (sessionId) =>
        engine
          .dispatch({
            commandId: CommandId.make(crypto.randomUUID()),
            command: Command.cases.Interrupt.make({ sessionId }),
            deviceLabel: "Polaris handover",
          })
          .pipe(
            Effect.asVoid,
            Effect.catchCause((c) => Effect.logError("Handover interrupt failed", c))
          ),
      retire: engine.retireLead,
    };
  })
);
