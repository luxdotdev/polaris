/**
 * Handler for `harness.models`: each Harness's Models, asked of the Harness
 * itself through its driver. The per-Host cache and the real listings are
 * ENG-202; until a driver lists its Models the answer is `HarnessUnavailable`.
 */
import {
  HarnessModels,
  HarnessUnavailable,
  isKnownHarness,
  ListModels,
  NotFound,
} from "@polaris/protocol";
import { Clock, Effect } from "effect";
import { RpcGroup } from "effect/rpc";
import { HarnessRegistry } from "../services.ts";

export class HarnessRpcs extends RpcGroup.make(ListModels) {}

export const handleListModels = Effect.fn("harness.models")(function* ({
  harness,
}: typeof ListModels.payloadSchema.Type) {
  const registry = yield* HarnessRegistry;

  if (!isKnownHarness(harness)) return yield* new NotFound({ what: "harness", id: harness });

  const driver = yield* registry
    .get(harness)
    .pipe(Effect.mapError(() => new NotFound({ what: "harness", id: harness })));

  const models = yield* (driver.listModels ?? Effect.succeed([])).pipe(
    Effect.mapError((error) => new HarnessUnavailable({ harness, message: error.message }))
  );

  return new HarnessModels({
    harness,
    models: [...models],
    switchesModel: driver.capabilities.switchModel,
    fetchedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
  });
});

/** Requires `HarnessRegistry`. */
export const HarnessRpcsLive = HarnessRpcs.toLayer({ "harness.models": handleListModels });
