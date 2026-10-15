import { LanguageCheckout, type HostId, type WorkspaceId } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import { registeredCheckout } from "../../languages/registeredCheckout.ts";
import {
  createExecutionTrust,
  createFileTrustRepository,
  trustDirectory,
} from "../../languages/trust/index.ts";
import { EventStore } from "../../store/EventStore.ts";
import { WorktreeSetupTrust } from "./trust.ts";

/** For tests about what setup does once it may run; Trust itself is tested with the real layer. */
export const trustedSetup = Layer.succeed(WorktreeSetupTrust)({ require: () => Effect.void });

/** The Editor's path: changes the Daemon's Trust records under `state` for a registered Workspace. */
export const changeTrust = (
  state: string,
  hostId: HostId,
  workspaceId: WorkspaceId,
  action: "trust" | "revoke"
) =>
  Effect.gen(function* () {
    const store = yield* EventStore;
    const workspace = (yield* store.model).workspaces.get(workspaceId);

    if (workspace === undefined) return yield* Effect.die(`${workspaceId} is not registered`);

    const trust = createExecutionTrust({
      hostId,
      registry: async (checkout) =>
        registeredCheckout(await Effect.runPromise(store.model), checkout),
      repository: createFileTrustRepository(trustDirectory(state)),
      authorizeGrant: async () => {},
    });

    const checkout = LanguageCheckout.cases.Workspace.make({ workspaceId, path: workspace.path });
    const current = yield* Effect.promise(() => trust.inspect(checkout));
    yield* Effect.promise(() => trust.change(checkout, action, current.trust.revision));
  });
