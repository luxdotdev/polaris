import { polaris } from "../../bridge.ts";
import type { AppState } from "../../../store/store.ts";
import { predictionPreferenceView } from "../../../../shared/predictionPlacement.ts";
import { registerEditorExtensions, type EditorFile } from "../api.ts";
import { languageFor } from "../model/language.ts";
import { type EditPredictionPort, predictionExtension } from "./index.ts";
import {
  editAvailable,
  hostConnected,
  inspectPredictionHost,
  loadPredictionTarget,
  preferencesOf,
  predictionStore,
  requestEditPrediction,
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

  const allowed = (file: EditorFile) =>
    predictionStore.getState().enabled &&
    preferencesOf(file.hostKey).placement !== "off" &&
    hostConnected(app().hosts, file.hostKey);

  const inspect = (file: EditorFile, refresh: boolean) => {
    void inspectPredictionHost(polaris(), file.hostKey, refresh).catch(() => undefined);
    void loadPredictionTarget(polaris(), file).catch(() => undefined);
  };

  const subscribe = (file: EditorFile) => (refresh: () => void) => {
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

      if (hostConnected(app().hosts, file.hostKey)) inspect(file, true);
    });

    const unsubscribeSettings = predictionStore.subscribe((state, previous) => {
      if (state.revision !== previous.revision) refresh();
    });

    if (hostConnected(app().hosts, file.hostKey)) inspect(file, false);

    return () => {
      unsubscribeHost?.();
      unsubscribeSettings();
      release(file);
    };
  };

  /** Both ports share one Host and settings subscription per view. */
  const shared = (file: EditorFile) => {
    const listeners = new Set<() => void>();
    let stop: (() => void) | null = null;

    return (refresh: () => void) => {
      listeners.add(refresh);
      stop ??= subscribe(file)(() => {
        for (const listener of listeners) listener();
      });

      return () => {
        listeners.delete(refresh);

        if (listeners.size === 0) {
          stop?.();
          stop = null;
        }
      };
    };
  };

  return registerEditorExtensions((file) => {
    const subscribeShared = shared(file);

    const language = languageFor(file.path);

    const edit: EditPredictionPort = {
      available: () =>
        allowed(file) &&
        editAvailable(file) &&
        !preferencesOf(file.hostKey).disabledLanguages.includes(language),
      request: (input, signal) => requestEditPrediction(polaris(), file, input, signal),
      settings: () => predictionPreferenceView(preferencesOf(file.hostKey)),
      subscribe: subscribeShared,
    };

    return predictionExtension(
      {
        allowed: () => allowed(file),
        request: (input, signal, preview) =>
          requestPrediction(polaris(), file, input, signal, preview),
        subscribe: subscribeShared,
      },
      edit
    );
  });
};
