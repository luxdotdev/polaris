import { DaemonRpcs } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import { VisualsSettingsStore } from "./settings.ts";

const GetHandler = DaemonRpcs.toLayerHandler(
  "sessions.visuals",
  Effect.gen(function* () {
    const store = yield* VisualsSettingsStore;

    return () => store.settings;
  })
);

const SetHandler = DaemonRpcs.toLayerHandler(
  "sessions.setVisuals",
  Effect.gen(function* () {
    const store = yield* VisualsSettingsStore;

    return ({ settings }) => store.setSettings(settings);
  })
);

/** `sessions.visuals` and `sessions.setVisuals` (capability `sessions.visuals`). */
export const VisualsRpcHandlers = Layer.mergeAll(GetHandler, SetHandler);
