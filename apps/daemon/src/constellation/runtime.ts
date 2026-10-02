import type {
  CommandId,
  ConstellationCommand,
  ConstellationRejected,
  EventEnvelope,
  HostId,
} from "@polaris/protocol";
import { Context, Effect } from "effect";
import type { ConstellationBinding, ConstellationContext } from "../engine/constellation.inputs.ts";
import type { ReadModel } from "../store/model.ts";

export type ConstellationPreparation = Pick<
  ConstellationContext,
  "attempts" | "newLeadSessionId" | "claimProbe" | "recordedChecks"
>;

/** Worktree, Harness and delivery slices inject side effects through this boundary. */
export interface ConstellationRuntimeService {
  readonly prepare: (
    binding: ConstellationBinding,
    command: ConstellationCommand,
    model: ReadModel,
    commandId: CommandId
  ) => Effect.Effect<ConstellationPreparation, ConstellationRejected>;
  /** Reacquire folded working assignments after Session recovery, without sending a first Turn. */
  readonly resumeWorking: () => Effect.Effect<void>;
  readonly afterCommit: (
    binding: ConstellationBinding,
    command: ConstellationCommand,
    envelopes: ReadonlyArray<EventEnvelope>
  ) => Effect.Effect<void>;
}

export class ConstellationRuntime extends Context.Reference<ConstellationRuntimeService>(
  "polaris/daemon/constellation/Runtime",
  {
    defaultValue: () => ({
      prepare: () =>
        Effect.succeed({
          attempts: [],
          newLeadSessionId: null,
          claimProbe: null,
          recordedChecks: [],
        }),
      resumeWorking: () => Effect.void,
      afterCommit: () => Effect.void,
    }),
  }
) {}

export class ConstellationOwner extends Context.Service<ConstellationOwner, HostId>()(
  "polaris/daemon/constellation/Owner"
) {}
