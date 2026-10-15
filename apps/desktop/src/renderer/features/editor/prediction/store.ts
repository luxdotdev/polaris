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
import type {
  ManagedServerAction,
  ManagedServerStatus,
  PredictionEndpoint,
} from "@polaris/protocol";
import type { PredictionSide } from "@polaris/client/prediction";
import { modelLabel } from "../../../../shared/modelNames.ts";
import {
  PredictionFeedItem,
  type PredictionContextSummary,
  type PredictionEnabled,
  type PredictionInspection,
} from "../../../../shared/predictionContract.ts";
import type { EditorFile } from "../api.ts";
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
  /** The managed model server of each side, keyed by `managedKey`, while something watches it. */
  readonly managed: Readonly<Record<string, ManagedServerStatus | null>>;
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
  managed: {},
}));

export const usePrediction = <A>(select: (state: PredictionState) => A): A =>
  useStore(predictionStore, select);

export const preferencesOf = (hostKey: string) =>
  predictionStore.getState().preferences[hostKey] ?? DEFAULT_PREDICTION_PREFERENCES;

export const modelName = (name: string) => modelLabel(name);

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

export const managedKey = (hostKey: string, side: PredictionSide) => `${hostKey}\u0000${side}`;

const managedWatches = new Map<string, { count: number; stop: () => void }>();

const BUSY_PHASES = new Set(["Downloading", "Verifying", "Starting", "Backoff"]);

/** Leaving a busy phase changes what placement can see, so the inspection is taken again. */
const settled = (
  before: ManagedServerStatus | null | undefined,
  after: ManagedServerStatus | null
) =>
  before !== null &&
  before !== undefined &&
  after !== null &&
  BUSY_PHASES.has(before.phase._tag) &&
  !BUSY_PHASES.has(after.phase._tag);

const rememberManaged = (
  hostKey: string,
  side: PredictionSide,
  status: ManagedServerStatus | null
) =>
  predictionStore.setState((state) => ({
    managed: { ...state.managed, [managedKey(hostKey, side)]: status },
    inspections:
      state.inspections[hostKey] === undefined
        ? state.inspections
        : {
            ...state.inspections,
            [hostKey]: {
              ...state.inspections[hostKey],
              managed: { ...state.inspections[hostKey].managed, [side]: status },
            },
          },
  }));

/** Follows one side's managed server while the card or Settings shows it; returns the release. */
export const watchManaged = (api: PolarisApi, hostKey: string, side: PredictionSide) => {
  const key = managedKey(hostKey, side);
  const active = managedWatches.get(key);

  if (active !== undefined) {
    active.count += 1;
  } else {
    const stop = api.subscribe(
      "prediction.managed.watch",
      { hostKey, side },
      {
        items: (items) => {
          const last = items.at(-1);

          if (last === undefined) return;
          const before = predictionStore.getState().managed[key];
          rememberManaged(hostKey, side, last);

          if (settled(before, last)) void checkPredictionAgain(api, hostKey);
        },
        end: () => {},
      }
    );

    managedWatches.set(key, { count: 1, stop });
  }

  return () => {
    const watch = managedWatches.get(key);

    if (watch === undefined) return;
    watch.count -= 1;

    if (watch.count === 0) {
      watch.stop();
      managedWatches.delete(key);
    }
  };
};

/** Runs one action on a side's managed server and keeps its reply; a download then re-probes. */
export const managedAction = async (
  api: PolarisApi,
  hostKey: string,
  side: PredictionSide,
  action: ManagedServerAction | null
) => {
  const status = valueOf(await api.request("prediction.managed", { hostKey, side, action }));
  rememberManaged(hostKey, side, status);

  if (action === "remove" || action === "stop") await checkPredictionAgain(api, hostKey);

  return status;
};
