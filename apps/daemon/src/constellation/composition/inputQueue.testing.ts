import { Layer } from "effect";
import { Engine, EngineConfig } from "../../engine/Engine.ts";
import {
  fakeServices,
  type Fakes,
  type FakeDriver,
  pendingReviewCheckoutGit,
} from "../../engine/testing.ts";
import { engineDeliveryLayer } from "../delivery/engine.ts";

export const inputQueueWorld = (fakes: Fakes, driver: FakeDriver) => {
  const engine = Engine.layer.pipe(
    Layer.provide(fakeServices(fakes, [driver])),
    Layer.provide(pendingReviewCheckoutGit),
    Layer.provide(
      Layer.succeed(EngineConfig)({ idleTimeout: "1 hour", checkpointSweepInterval: null })
    )
  );

  return { driver, layer: engineDeliveryLayer.pipe(Layer.provideMerge(engine)) };
};
