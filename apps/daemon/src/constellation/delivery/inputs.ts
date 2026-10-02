import type { AttemptId, ConstellationId, HostId, SessionId, Turn } from "@polaris/protocol";
import { Context, Data, Effect } from "effect";

/** Structurally identical to W's RemoteDeliveryPacket; no dependency on its transport implementation. */
export interface DeliveryPacket {
  readonly id: string;
  readonly ownerHostId: HostId;
  readonly workerHostId: HostId;
  readonly constellationId: ConstellationId;
  readonly attemptId: AttemptId;
  readonly sessionId: SessionId;
  readonly input:
    | { readonly _tag: "Turn"; readonly text: string; readonly cause: string }
    | { readonly _tag: "Steer"; readonly text: string };
}

export const DeliveryInput = Data.taggedEnum<DeliveryPacket["input"]>();

export interface DeliverySessionEffects {
  readonly runTurn: (turn: Turn, prompt: string) => Effect.Effect<void>;
  readonly canSteer: (sessionId: SessionId) => Effect.Effect<boolean>;
  readonly steer: (sessionId: SessionId, text: string) => Effect.Effect<void>;
  readonly retire: (sessionId: SessionId) => Effect.Effect<void>;
  readonly interrupt: (sessionId: SessionId) => Effect.Effect<void>;
}

export class ConstellationSessionEffects extends Context.Service<
  ConstellationSessionEffects,
  DeliverySessionEffects
>()("polaris/daemon/constellation/SessionEffects") {}

export class ConstellationRemoteDelivery extends Context.Reference<{
  readonly send: (packet: DeliveryPacket) => Effect.Effect<void>;
}>("polaris/daemon/constellation/RemoteDelivery", {
  defaultValue: () => ({ send: () => Effect.never }),
}) {}

export interface RecoveryCandidate {
  readonly sessionId: SessionId;
  readonly interruptionId: string;
}
