import { LanguageCheckout, WorkspaceId } from "@polaris/protocol";
import { Context, Effect, Layer, Schema } from "effect";
import { registeredCheckout } from "../../languages/registeredCheckout.ts";
import {
  createExecutionTrust,
  createFileTrustRepository,
  trustDirectory,
} from "../../languages/trust/index.ts";
import { EventStore } from "../../store/EventStore.ts";
import { ConstellationOwner } from "../runtime.ts";

/** Worktree setup would run a Workspace's own code, and the user hasn't trusted it on this Host. */
export class WorktreeSetupUntrusted extends Schema.TaggedError<WorktreeSetupUntrusted>()(
  "WorktreeSetupUntrusted",
  { workspaceId: WorkspaceId, workspace: Schema.String }
) {}

/** Setup reads the Host's Trust and never grants it; any doubt counts as untrusted. */
export class WorktreeSetupTrust extends Context.Service<
  WorktreeSetupTrust,
  {
    readonly require: (workspaceId: WorkspaceId) => Effect.Effect<void, WorktreeSetupUntrusted>;
  }
>()("polaris/daemon/WorktreeSetupTrust") {
  /** `root` is the Daemon's private directory, whose Trust records the Editor also reads. */
  static layer(root: string) {
    return Layer.effect(
      WorktreeSetupTrust,
      Effect.gen(function* () {
        const store = yield* EventStore;

        const trust = createExecutionTrust({
          hostId: yield* ConstellationOwner,
          registry: async (checkout) =>
            registeredCheckout(await Effect.runPromise(store.model), checkout),
          repository: createFileTrustRepository(trustDirectory(root)),
          authorizeGrant: () => Promise.reject(new Error("Worktree setup cannot grant trust")),
        });

        const require = Effect.fn("WorktreeSetupTrust.require")(function* (
          workspaceId: WorkspaceId
        ) {
          const workspace = (yield* store.model).workspaces.get(workspaceId);

          const untrusted = new WorktreeSetupUntrusted({
            workspaceId,
            workspace: workspace?.name ?? workspaceId,
          });

          if (workspace === undefined) return yield* untrusted;

          yield* Effect.tryPromise({
            try: () =>
              trust.require(
                LanguageCheckout.cases.Workspace.make({ workspaceId, path: workspace.path })
              ),
            catch: () => untrusted,
          });
        });

        return { require };
      })
    );
  }
}
