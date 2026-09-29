/** The session view's reads: the open session, its Host, the Harness's Models, a clock. */
import type { Capability, SessionId } from "@polaris/protocol";
import { useEffect, useState } from "react";
import type { HostView } from "../../../shared/api.ts";
import { emptySessionModel, type SessionModel } from "../../store/sessionModel.ts";
import { sessionKey } from "../../store/store.ts";
import { useApp, useSessionFeed } from "../../views/hooks.ts";
import type { ModelData } from "./model/models.ts";
import { polaris } from "./bridge.ts";

/** Keeps the session's feed open and returns its model (empty until the Snapshot lands). */
export const useSession = (hostKey: string, sessionId: SessionId): SessionModel => {
  useSessionFeed(hostKey, sessionId);

  return useApp((s) => s.sessions[sessionKey(hostKey, sessionId)]) ?? emptySessionModel;
};

export const useHost = (hostKey: string): HostView | undefined =>
  useApp((s) => s.hosts.find((h) => h.key === hostKey));

export const hasCapability = (host: HostView | undefined, capability: Capability) =>
  host?.status.capabilities.includes(capability) ?? false;

export interface ModelsState {
  readonly models: ReadonlyArray<ModelData>;
  /** The Harness can change Model between Turns (`SetModel`); otherwise offer a Fork. */
  readonly switchesModel: boolean;
  readonly error: string | null;
  readonly loading: boolean;
}

const NO_MODELS: ModelsState = { models: [], switchesModel: false, error: null, loading: true };

const modelCache = new Map<string, Promise<ModelsState>>();

const fetchModels = (hostKey: string, harness: string): Promise<ModelsState> => {
  const key = `${hostKey}\u0000${harness}`;
  const cached = modelCache.get(key);

  if (cached !== undefined) return cached;

  const request = polaris()
    .request("harness.models", { hostKey, harness, refresh: false })
    .then((result): ModelsState =>
      result.ok
        ? { ...result.value, error: null, loading: false }
        : { ...NO_MODELS, error: result.error.message, loading: false }
    );

  // A failure is retried the next time the picker opens.
  void request.then((state) => (state.error === null ? undefined : modelCache.delete(key)));
  modelCache.set(key, request);

  return request;
};

/** A Harness's Models on a Host; asked once per Host and Harness, then cached. */
export const useHarnessModels = (hostKey: string, harness: string, enabled = true) => {
  const [state, setState] = useState<{ key: string; value: ModelsState } | null>(null);
  const key = `${hostKey}\u0000${harness}`;

  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;

    void fetchModels(hostKey, harness).then((value) => {
      if (live) setState({ key, value });
    });

    return () => {
      live = false;
    };
  }, [enabled, hostKey, harness, key]);

  return state?.key === key ? state.value : NO_MODELS;
};

/** Milliseconds since `since`, ticking once a second while `running`. */
export const useElapsed = (since: string | null, running: boolean): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [running]);

  return since === null ? 0 : Math.max(0, now - Date.parse(since));
};
