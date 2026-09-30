/**
 * Live Harness facts per Host: availability (`harness.watchAvailability`) and
 * Plan Limits (`usage.watch`), each one shared feed per Host while any view
 * needs it, and Models (`harness.models`), asked once per Host and Harness
 * until the user refreshes.
 */
import type { HarnessKind } from "@polaris/protocol";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { HostView } from "../../../shared/api.ts";
import { useApp } from "../../shell/hooks.ts";
import { polaris } from "../bridge.ts";
import { type LimitData, upsertLimit } from "./model/limits.ts";
import type { ModelData } from "./model/models.ts";
import { type AvailabilityReport, type HarnessOption, harnessOptions } from "./model/options.ts";

interface LiveState {
  readonly reports: Readonly<Record<string, AvailabilityReport>>;
  readonly limits: Readonly<Record<string, ReadonlyArray<LimitData>>>;
}

const live = createStore<LiveState>(() => ({ reports: {}, limits: {} }));

const feeds = new Map<string, { refs: number; close: () => void }>();

/** Keeps a feed open while any view holds it; the last release closes it. */
const hold = (key: string, open: () => () => void) => {
  const feed = feeds.get(key);

  if (feed !== undefined) feed.refs++;
  else feeds.set(key, { refs: 1, close: open() });

  return () => {
    const held = feeds.get(key);

    if (held === undefined || --held.refs > 0) return;
    feeds.delete(key);
    held.close();
  };
};

const setReport = (hostKey: string, report: AvailabilityReport) =>
  live.setState((s) => ({ reports: { ...s.reports, [hostKey]: report } }));

const openAvailability = (hostKey: string) =>
  polaris().subscribe(
    "harness.availability",
    { hostKey },
    { items: (items) => items.forEach((report) => setReport(hostKey, report)) }
  );

const openLimits = (hostKey: string) =>
  polaris().subscribe(
    "plan-limits",
    { hostKey },
    {
      items: (items) =>
        live.setState((s) => ({
          limits: { ...s.limits, [hostKey]: items.reduce(upsertLimit, s.limits[hostKey] ?? []) },
        })),
    }
  );

const useHostView = (hostKey: string): HostView | undefined =>
  useApp((s) => s.hosts.find((h) => h.key === hostKey));

const has = (host: HostView | undefined, capability: string) =>
  host?.status.capabilities.some((c) => c === capability) ?? false;

/** Probes the Host's Harnesses again (after a sign-in, or on request). */
export const refreshAvailability = async (hostKey: string) => {
  const result = await polaris().request("harness.availability", { hostKey, refresh: true });

  if (result.ok) setReport(hostKey, result.value);
};

export interface Availability {
  readonly options: ReadonlyArray<HarnessOption>;
  /** Still waiting for the Host's first report. */
  readonly loading: boolean;
  readonly refresh: () => void;
}

/** A Host's Harnesses, live; without the capability, its drivers (status unknown). */
export const useAvailability = (hostKey: string): Availability => {
  const host = useHostView(hostKey);
  const connected = host?.status.state === "connected";
  const canWatch = connected && has(host, "harness.availability");
  const report = useStore(live, (s) => s.reports[hostKey]);

  useEffect(
    () => (canWatch ? hold(`availability:${hostKey}`, () => openAvailability(hostKey)) : undefined),
    [canWatch, hostKey]
  );

  return {
    options: harnessOptions(canWatch ? (report ?? null) : null, host?.status.capabilities ?? []),
    loading: canWatch && report === undefined,
    refresh: () => void refreshAvailability(hostKey),
  };
};

const NO_REPORTS: Readonly<Record<string, AvailabilityReport>> = {};

/**
 * The raw reports (versions, sign-in argv) of several Hosts, live, for Settings → Harnesses;
 * pass only Hosts that are connected with `harness.availability`. Missing until the first report.
 */
export const useAvailabilityReports = (
  hostKeys: ReadonlyArray<string>
): Readonly<Record<string, AvailabilityReport>> => {
  const joined = hostKeys.join("\u0000");

  useEffect(() => {
    const keys = joined === "" ? [] : joined.split("\u0000");
    const releases = keys.map((k) => hold(`availability:${k}`, () => openAvailability(k)));

    return () => {
      for (const release of releases) release();
    };
  }, [joined]);

  return useStore(live, (s) => s.reports) ?? NO_REPORTS;
};

const NO_LIMITS: ReadonlyArray<LimitData> = [];

/** A Host's Plan Limits, live (capability `usage`); empty where the Daemon has none. */
export const usePlanLimits = (hostKey: string): ReadonlyArray<LimitData> => {
  const host = useHostView(hostKey);
  const canWatch = host?.status.state === "connected" && has(host, "usage");

  useEffect(
    () => (canWatch ? hold(`limits:${hostKey}`, () => openLimits(hostKey)) : undefined),
    [canWatch, hostKey]
  );

  return useStore(live, (s) => s.limits[hostKey]) ?? NO_LIMITS;
};

export interface ModelsState {
  readonly models: ReadonlyArray<ModelData>;
  /** The Harness can change an Agent Session's Model between Turns (`SetModel`). */
  readonly switchesModel: boolean;
  readonly error: string | null;
  readonly loading: boolean;
}

const NO_MODELS: ModelsState = { models: [], switchesModel: false, error: null, loading: true };

const modelCache = new Map<string, Promise<ModelsState>>();

const fetchModels = (hostKey: string, harness: HarnessKind, refresh: boolean) => {
  const key = `${hostKey}\u0000${harness}`;
  const cached = modelCache.get(key);

  if (cached !== undefined && !refresh) return cached;

  const request = polaris()
    .request("harness.models", { hostKey, harness, refresh })
    .then((result): ModelsState =>
      result.ok
        ? { ...result.value, error: null, loading: false }
        : { ...NO_MODELS, error: result.error.message, loading: false }
    );

  // A failure is asked again the next time a picker opens.
  void request.then((state) => (state.error === null ? undefined : modelCache.delete(key)));
  modelCache.set(key, request);

  return request;
};

/** A Harness's Models on a Host, cached per Host and Harness; `refresh` asks the Harness again. */
export const useHarnessModels = (hostKey: string, harness: HarnessKind, enabled = true) => {
  const [state, setState] = useState<{ key: string; value: ModelsState } | null>(null);
  const [round, setRound] = useState(0);
  const key = `${hostKey}\u0000${harness}`;

  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;

    void fetchModels(hostKey, harness, round > 0).then((value) => {
      if (current) setState({ key, value });
    });

    return () => {
      current = false;
    };
  }, [enabled, hostKey, harness, key, round]);

  const value = state?.key === key ? state.value : NO_MODELS;

  return { ...value, refresh: () => setRound(round + 1) };
};
