import { provisionalLine } from "@polaris/predict";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { WorkspaceId } from "@polaris/protocol";
import type { HostView, PolarisApi, Result } from "../../../../shared/api.ts";
import {
  DEFAULT_PREDICTION_PREFERENCES,
  type PredictionClientEndpoints,
  type PredictionPreferences,
} from "../../../../shared/predictionPlacement.ts";
import type { PredictionEndpoint } from "@polaris/protocol";
import type { PredictionSide } from "@polaris/client/prediction";
import {
  EditPredictionFeedItem,
  PredictionFeedItem,
  type PredictionContextSummary,
  type PredictionEnabled,
  type PredictionInspection,
  type PredictionWorkspaceTarget,
} from "../../../../shared/predictionContract.ts";
import type { EditorFile } from "../api.ts";
import type { EditFinal, EditPredictionInput } from "./edit/index.ts";
import type { PredictionInput, Prediction } from "./types.ts";

import { markPrediction } from "./timing.ts";

export interface CompletionStatus {
  readonly model: string;
  readonly machine: string;
  readonly elapsedMs: number;
  readonly side?: PredictionSide | undefined;
  readonly endpoint?: PredictionEndpoint | undefined;
  readonly latency?:
    | { readonly p50: number; readonly last: number; readonly count: number }
    | null
    | undefined;
  readonly context?: PredictionContextSummary | null | undefined;
}

export interface PredictionState {
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly loaded: boolean;
  readonly revision: number;
  readonly clientEndpoints: PredictionClientEndpoints;
  readonly preferences: Readonly<Record<string, PredictionPreferences>>;
  readonly inspections: Readonly<Record<string, PredictionInspection>>;
  readonly results: Readonly<Record<string, CompletionStatus>>;
  readonly failures: Readonly<Record<string, string>>;
  /** What `prediction.target` answered per Workspace (`targetKey`): whether a next-edit model serves it. */
  readonly targets: Readonly<Record<string, PredictionWorkspaceTarget>>;
}

export const predictionStore = createStore<PredictionState>(() => ({
  enabled: false,
  configured: false,
  loaded: false,
  revision: 0,
  clientEndpoints: [],
  preferences: {},
  inspections: {},
  results: {},
  failures: {},
  targets: {},
}));

export const usePrediction = <A>(select: (state: PredictionState) => A): A =>
  useStore(predictionStore, select);

export const preferencesOf = (hostKey: string) =>
  predictionStore.getState().preferences[hostKey] ?? DEFAULT_PREDICTION_PREFERENCES;

const MODEL_NAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/mellum/i, "Mellum2"],
  [/qwen2\.5/i, "Qwen2.5-Coder"],
  [/zeta[\W_]*2[._-]?1/i, "Zeta 2.1"],
  [/sweep.*next[\W_]*edit/i, "Sweep Next-Edit"],
];

export const modelName = (name: string) =>
  MODEL_NAMES.find(([pattern]) => pattern.test(name))?.[1] ?? name;

export const targetKey = (file: Pick<EditorFile, "hostKey" | "workspaceId">) =>
  JSON.stringify([file.hostKey, file.workspaceId]);

/** A next-edit model serves this Workspace, as of the last `prediction.target` answer. */
export const editAvailable = (file: Pick<EditorFile, "hostKey" | "workspaceId">) =>
  predictionStore.getState().targets[targetKey(file)]?.editAvailable === true;

export const hostConnected = (hosts: ReadonlyArray<HostView>, hostKey: string) =>
  hosts.find((host) => host.key === hostKey)?.status.state === "connected";

const valueOf = <A>(result: Result<A>): A => {
  if (!result.ok) throw new Error(result.error.message);

  return result.value;
};

let loaded: Promise<void> | null = null;

const hostsLoading = new Map<string, Promise<void>>();

export const loadPredictionSettings = (api: PolarisApi): Promise<void> => {
  loaded ??= Promise.all([
    api.request("prediction.enabled.get", {}),
    api.request("prediction.clientEndpoints.get", {}),
  ])
    .then(([enabled, endpoints]) =>
      predictionStore.setState((state) => ({
        ...valueOf(enabled),
        clientEndpoints: valueOf(endpoints),
        loaded: true,
        revision: state.revision + 1,
      }))
    )
    .catch((error) => {
      loaded = null;
      throw error;
    });

  return loaded;
};

export const inspectPredictionHost = (
  api: PolarisApi,
  hostKey: string,
  refresh = false
): Promise<void> => {
  const active = hostsLoading.get(hostKey);

  if (active) return active;

  if (!refresh && predictionStore.getState().inspections[hostKey]) return Promise.resolve();

  const load = Promise.all([
    loadPredictionSettings(api),
    api.request("prediction.settings.get", { hostKey }),
    api.request("prediction.inspect", { hostKey }),
  ])
    .then(([_loaded, preferences, inspection]) =>
      predictionStore.setState((state) => ({
        preferences: { ...state.preferences, [hostKey]: valueOf(preferences) },
        inspections: { ...state.inspections, [hostKey]: valueOf(inspection) },
        failures: { ...state.failures, [hostKey]: "" },
        revision: state.revision + 1,
      }))
    )
    .finally(() => hostsLoading.delete(hostKey));

  hostsLoading.set(hostKey, load);

  return load;
};

const targetsLoading = new Map<string, Promise<void>>();

/** Asks which model serves the Workspace; the answer decides the edit or FIM path. */
export const loadPredictionTarget = (
  api: PolarisApi,
  file: Pick<EditorFile, "hostKey" | "workspaceId">
): Promise<void> => {
  const key = targetKey(file);
  const active = targetsLoading.get(key);

  if (active) return active;

  const load = api
    .request("prediction.target", { hostKey: file.hostKey, workspaceId: file.workspaceId })
    .then((result) => {
      const target = valueOf(result);
      predictionStore.setState((state) =>
        state.targets[key]?.editAvailable === target.editAvailable &&
        state.targets[key]?.target?.model === target.target?.model
          ? { targets: { ...state.targets, [key]: target } }
          : { targets: { ...state.targets, [key]: target }, revision: state.revision + 1 }
      );
    })
    .finally(() => targetsLoading.delete(key));

  targetsLoading.set(key, load);

  return load;
};

export const setPredictionEnabled = async (
  api: PolarisApi,
  enabled: boolean
): Promise<PredictionEnabled> => {
  const saved = valueOf(await api.request("prediction.enabled.set", { enabled }));
  predictionStore.setState((state) => ({ ...saved, revision: state.revision + 1 }));

  return saved;
};

export const setPredictionPreferences = async (
  api: PolarisApi,
  hostKey: string,
  preferences: PredictionPreferences
) => {
  const saved = valueOf(await api.request("prediction.settings.set", { hostKey, preferences }));
  predictionStore.setState((state) => ({
    preferences: { ...state.preferences, [hostKey]: saved },
    revision: state.revision + 1,
  }));
  await setPredictionEnabled(api, predictionStore.getState().enabled);
};

export const setClientEndpoints = async (api: PolarisApi, endpoints: PredictionClientEndpoints) => {
  const saved = valueOf(await api.request("prediction.clientEndpoints.set", { endpoints }));
  predictionStore.setState((state) => ({ clientEndpoints: saved, revision: state.revision + 1 }));
  await setPredictionEnabled(api, predictionStore.getState().enabled);
};

export const turnOnDiscoveredServer = async (api: PolarisApi, hostKey: string) => {
  const inspection = predictionStore.getState().inspections[hostKey];
  const client = inspection?.client.endpoints.find((endpoint) => endpoint.models.length > 0);
  const host = inspection?.host?.endpoints.find((endpoint) => endpoint.models.length > 0);

  if (client) await setClientEndpoints(api, [{ kind: client.kind, url: client.url }]);
  else if (host)
    await setPredictionPreferences(api, hostKey, {
      ...preferencesOf(hostKey),
      hostEndpoints: [{ kind: host.kind, url: host.url }],
    });
  else throw new Error("No model server found");
  await setPredictionEnabled(api, true);
};

export const setHostPreferences = (
  api: PolarisApi,
  hostKey: string,
  patch: Partial<PredictionPreferences>
) => setPredictionPreferences(api, hostKey, { ...preferencesOf(hostKey), ...patch });

/** Clears the last failure and asks both sides again; the next keystroke retries completion. */
export const checkPredictionAgain = (api: PolarisApi, hostKey: string) => {
  predictionStore.setState((state) => ({ failures: { ...state.failures, [hostKey]: "" } }));

  return inspectPredictionHost(api, hostKey, true);
};

/** Deltas are display-only; only Final can enable acceptance. */
export const requestPrediction = (
  api: PolarisApi,
  file: EditorFile,
  input: PredictionInput,
  signal: AbortSignal,
  preview?: (text: string) => void
): Promise<Prediction> =>
  new Promise((resolve, reject) => {
    let settled = false;
    let text = "";
    let stop = () => {};

    const finish = (prediction: Prediction | null, error?: string) => {
      if (settled) return;
      settled = true;
      stop();
      signal.removeEventListener("abort", abort);

      if (prediction) resolve(prediction);
      else reject(new Error(error ?? "Prediction cancelled"));
    };

    const abort = () => finish(null);

    if (signal.aborted) {
      abort();

      return;
    }

    signal.addEventListener("abort", abort, { once: true });
    markPrediction("ipc");
    stop = api.subscribe(
      "prediction.complete",
      {
        ...file,
        ...input,
        dispatchedAt: performance.timeOrigin + performance.now(),
        workspaceId: WorkspaceId.make(file.workspaceId),
        recentEdits: [],
        budgetTokens: 2048,
      },
      {
        items: (items) => {
          if (settled || signal.aborted) return;

          for (const item of items)
            PredictionFeedItem.match(item, {
              Reset: () => {
                text = "";
                preview?.("");
              },
              Delta: (delta) => {
                text += delta.text;
                preview?.(provisionalLine(text));
              },
              Final: (result) => {
                markPrediction("final", result.timings);
                predictionStore.setState((state) => ({
                  results: { ...state.results, [file.hostKey]: result },
                  failures: { ...state.failures, [file.hostKey]: "" },
                }));
                finish({ text: result.text });
              },
            });
        },
        end: (error) => {
          if (settled || signal.aborted) return;
          const message = error?.message ?? "Prediction ended without a final result";
          predictionStore.setState((state) => ({
            failures: { ...state.failures, [file.hostKey]: message },
          }));
          finish(null, message);
        },
      }
    );

    if (settled) stop();
  });

/** One `prediction.edit` request; unsubscribing on abort cancels the HTTP request behind it. */
export const requestEditPrediction = (
  api: PolarisApi,
  file: EditorFile,
  input: EditPredictionInput,
  signal: AbortSignal
): Promise<EditFinal> =>
  new Promise((resolve, reject) => {
    let settled = false;
    let stop = () => {};

    const finish = (final: EditFinal | null, error?: string) => {
      if (settled) return;
      settled = true;
      stop();
      signal.removeEventListener("abort", abort);

      if (final) resolve(final);
      else reject(new Error(error ?? "Prediction cancelled"));
    };

    const abort = () => finish(null);

    if (signal.aborted) {
      abort();

      return;
    }

    signal.addEventListener("abort", abort, { once: true });
    markPrediction("ipc");
    stop = api.subscribe(
      "prediction.edit",
      {
        ...file,
        ...input,
        dispatchedAt: performance.timeOrigin + performance.now(),
        workspaceId: WorkspaceId.make(file.workspaceId),
        recentEdits: [],
        budgetTokens: 2048,
      },
      {
        items: (items) => {
          if (settled || signal.aborted) return;

          for (const item of items)
            EditPredictionFeedItem.match(item, {
              Final: (result) => {
                markPrediction("final", result.timings);
                predictionStore.setState((state) => ({
                  results: {
                    ...state.results,
                    [file.hostKey]: {
                      model: result.model,
                      machine: result.machine,
                      elapsedMs: result.elapsedMs,
                      side: result.side,
                      endpoint: result.endpoint,
                      latency: result.latency,
                      context: result.context,
                    },
                  },
                  failures: { ...state.failures, [file.hostKey]: "" },
                }));
                finish(result);
              },
            });
        },
        end: (error) => {
          if (settled || signal.aborted) return;
          const message = error?.message ?? "Prediction ended without a final result";
          predictionStore.setState((state) => ({
            failures: { ...state.failures, [file.hostKey]: message },
          }));
          finish(null, message);
        },
      }
    );

    if (settled) stop();
  });
