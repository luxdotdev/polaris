/**
 * `WorkspaceTrust` on the Trust records worktree setup reads (`WorktreeSetupTrust`),
 * loaded on the first ask so Daemon startup imports none of the Trust runtime.
 */
import { HostId } from "@polaris/protocol";
import { Effect, Exit, Layer } from "effect";
import { WorkspaceTrust } from "../services.ts";
import { EventStore } from "../store/EventStore.ts";
import { loadHostId } from "./hostInfo.ts";

/** `root`: the Daemon's private directory, as the Constellation composition passes it. */
export const workspaceTrustLayer = (root: string) =>
  Layer.effect(
    WorkspaceTrust,
    Effect.gen(function* () {
      const store = yield* EventStore;

      const setupTrust = yield* Effect.cached(
        Effect.gen(function* () {
          const { WorktreeSetupTrust } = yield* Effect.promise(
            () => import("../constellation/setup/trust.ts")
          );

          const { ConstellationOwner } = yield* Effect.promise(
            () => import("../constellation/runtime.ts")
          );

          const hostId = HostId.make(yield* loadHostId(root));

          const layer = WorktreeSetupTrust.layer(root).pipe(
            Layer.provide(Layer.succeed(ConstellationOwner)(hostId)),
            Layer.provide(Layer.succeed(EventStore)(store))
          );

          return yield* Effect.provide(Effect.service(WorktreeSetupTrust), layer);
        })
      );

      return WorkspaceTrust.of({
        trusted: (workspaceId) =>
          setupTrust.pipe(
            Effect.flatMap((trust) => trust.require(workspaceId)),
            Effect.exit,
            Effect.map(Exit.isSuccess)
          ),
      });
    })
  );
