import { polaris } from "../../bridge.ts";
import type { AppState } from "../../../store/store.ts";
import { registerEditorExtensions, type EditorFile } from "../api.ts";
import { predictionExtension } from "./index.ts";
import {
  hostConnected,
  inspectPredictionHost,
  preferencesOf,
  predictionStore,
  requestPrediction,
} from "./store.ts";

/** Keeps prediction lifetimes tied to the existing Editor views and Host epochs. */
export const installPredictions = (
  app: () => AppState,
  subscribeApp?: (changed: () => void) => () => void
) => {
  const workspaces = new Map<string, number>();

  const release = (file: EditorFile) => {
    const key = JSON.stringify([file.hostKey, file.workspaceId]);
    const remaining = (workspaces.get(key) ?? 1) - 1;

    if (remaining > 0) workspaces.set(key, remaining);
    else {
      workspaces.delete(key);
      void polaris().request("prediction.release", file);
    }
  };

  return registerEditorExtensions((file) =>
    predictionExtension({
      allowed: () =>
        predictionStore.getState().enabled &&
        preferencesOf(file.hostKey).placement !== "off" &&
        hostConnected(app().hosts, file.hostKey),
      request: (input, signal, preview) =>
        requestPrediction(polaris(), file, input, signal, preview),
      subscribe: (refresh) => {
        const key = JSON.stringify([file.hostKey, file.workspaceId]);
        workspaces.set(key, (workspaces.get(key) ?? 0) + 1);

        const epoch = () => {
          const host = app().hosts.find((item) => item.key === file.hostKey);

          return `${host?.status.state}:${host?.status.epoch}`;
        };

        let last = epoch();

        const unsubscribeHost = subscribeApp?.(() => {
          const next = epoch();

          if (next === last) return;
          last = next;
          refresh();

          if (hostConnected(app().hosts, file.hostKey))
            void inspectPredictionHost(polaris(), file.hostKey, true).catch(() => undefined);
        });

        const unsubscribeSettings = predictionStore.subscribe((state, previous) => {
          if (state.revision !== previous.revision) refresh();
        });

        if (hostConnected(app().hosts, file.hostKey))
          void inspectPredictionHost(polaris(), file.hostKey).catch(() => undefined);

        return () => {
          unsubscribeHost?.();
          unsubscribeSettings();
          release(file);
        };
      },
    })
  );
};
