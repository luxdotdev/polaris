/**
 * Handler for `harness.models`: each Harness's Models, asked of the Harness
 * itself through its driver (ENG-202) and cached per Host for the Daemon's
 * lifetime. `refresh` asks again; a failed listing is never cached. Also mounts
 * `harness.commands` (`CommandLists.ts`) and `harness.spinnerVerbs` (claude/spinnerVerbs.ts).
 */
import {
  ClaudeSpinnerVerbs,
  type HarnessKind,
  HarnessModels,
  HarnessUnavailable,
  isKnownHarness,
  ListHarnessCommands,
  ListModels,
  NotFound,
} from "@polaris/protocol";
import { Clock, Effect } from "effect";
import { RpcGroup } from "effect/rpc";
import { lacksUserAccess } from "../userAccess/index.ts";
import { HarnessRegistry } from "../services.ts";
import { commandLists, notListed } from "./CommandLists.ts";
import { spinnerVerbsHandler } from "./claude/spinnerVerbs.ts";

export class HarnessRpcs extends RpcGroup.make(
  ListModels,
  ListHarnessCommands,
  ClaudeSpinnerVerbs
) {}

type Listing = Effect.Effect<HarnessModels, NotFound | HarnessUnavailable>;

/** Asks the Harness, through its driver, for its Models. */
const fetchModels = (harness: HarnessKind) =>
  Effect.gen(function* () {
    const registry = yield* HarnessRegistry;

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
      backgroundsCommands: driver.capabilities.backgroundCommand === true,
      runsShellCommands: driver.capabilities.shellCommand === true,
      steersAttachments: driver.capabilities.steerAttachments === true,
      fetchedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    });
  });

/** `harness.models` with the per-Host cache; concurrent askers share one listing. */
export const makeModelLists = Effect.gen(function* () {
  const registry = yield* HarnessRegistry;
  const cache = new Map<HarnessKind, Listing>();

  const fresh = (harness: HarnessKind) =>
    Effect.gen(function* () {
      const once = yield* Effect.cached(
        fetchModels(harness).pipe(
          Effect.provideService(HarnessRegistry, registry),
          Effect.tapError(() => Effect.sync(() => cache.delete(harness)))
        )
      );

      cache.set(harness, once);

      return once;
    });

  /** `cacheOnly`: asking a Harness may start its program, so the answer is only what is cached. */
  return Effect.fn("harness.models")(function* (
    { harness, refresh }: typeof ListModels.payloadSchema.Type,
    cacheOnly = false
  ) {
    if (!isKnownHarness(harness)) return yield* new NotFound({ what: "harness", id: harness });
    const cached = refresh && !cacheOnly ? undefined : cache.get(harness);

    if (cached === undefined && cacheOnly) return yield* notListed(harness);

    return yield* cached ?? (yield* fresh(harness));
  });
});

/** Requires `HarnessRegistry`. */
export const HarnessRpcsLive = HarnessRpcs.toLayer(
  Effect.gen(function* () {
    const models = yield* makeModelLists;
    const commands = yield* commandLists;

    // Without user access a caller is served the cache alone (ADR 0114).
    return {
      "harness.models": (payload, { client }) =>
        models(payload, lacksUserAccess(client.annotations)),
      "harness.commands": (payload, { client }) =>
        commands(payload, lacksUserAccess(client.annotations)),
      "harness.spinnerVerbs": spinnerVerbsHandler(),
    };
  })
);
