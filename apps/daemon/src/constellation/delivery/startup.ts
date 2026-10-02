import type { SessionId } from "@polaris/protocol";
import { Effect, Stream } from "effect";
import type { ConstellationRuntimeService } from "../runtime.ts";
import { ConstellationDelivery } from "./index.ts";

export interface DeliveryStartup {
  readonly runtime: ConstellationRuntimeService;
  readonly resumeRemote?: Effect.Effect<void>;
  readonly acknowledged?: Stream.Stream<
    ReadonlyArray<{ readonly id: string; readonly sessionId: SessionId }>
  >;
}

/** After Session recovery and revocation replay; resume hooks call recoverAttempt only after acquiring their resources. */
export const startConstellationDelivery = Effect.fn("Constellation.startDelivery")(function* (
  startup: DeliveryStartup
) {
  const delivery = yield* ConstellationDelivery;
  yield* startup.runtime.resumeWorking();
  yield* startup.resumeRemote ?? Effect.void;

  if (startup.acknowledged !== undefined)
    yield* startup.acknowledged.pipe(
      Stream.runForEach((packets) =>
        Effect.forEach(packets, (packet) => delivery.acknowledge(packet.id, packet.sessionId), {
          discard: true,
        })
      ),
      Effect.catchCause((cause) =>
        Effect.logError("Remote input receipt observation failed", cause)
      ),
      Effect.forkScoped
    );
  yield* delivery.start();
});
