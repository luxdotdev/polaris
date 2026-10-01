/**
 * Settings → Hosts' resources and worker cap, over C1-R's RPCs (`host.resources.get`,
 * `.declare`, `.remove`, `.release`, `host.workers.setCap`); every call answers with the
 * Host's whole snapshot. The IPC client by default; previews swap in a fake.
 */
import { useCallback, useEffect, useState } from "react";
import type { Result } from "../../../shared/api.ts";
import { useApp } from "../../shell/hooks.ts";
import { polaris } from "../bridge.ts";
import { showRefusal } from "../session/dispatch.ts";
import { newCommandId } from "../sessions/constellationApi.ts";
import type { HostResourcesSnapshot } from "./model/resources.ts";

export interface ResourcesClient {
  readonly get: (hostKey: string) => Promise<Result<HostResourcesSnapshot>>;
  readonly declare: (
    hostKey: string,
    input: { readonly name: string; readonly capacity?: number; readonly holdLimitMs?: number }
  ) => Promise<Result<HostResourcesSnapshot>>;
  readonly remove: (hostKey: string, name: string) => Promise<Result<HostResourcesSnapshot>>;
  readonly release: (hostKey: string, leaseId: string) => Promise<Result<HostResourcesSnapshot>>;
  readonly setCap: (hostKey: string, cap: number | null) => Promise<Result<HostResourcesSnapshot>>;
}

/** The Daemon's own answers, over the IPC bridge; a Daemon without `host.resources` refuses. */
const ipcClient: ResourcesClient = {
  get: (hostKey) => polaris().request("host.resources.get", { hostKey }),
  declare: (hostKey, input) =>
    polaris().request("host.resources.declare", { hostKey, commandId: newCommandId(), ...input }),
  remove: (hostKey, name) =>
    polaris().request("host.resources.remove", { hostKey, commandId: newCommandId(), name }),
  release: (hostKey, leaseId) =>
    polaris().request("host.resources.release", { hostKey, commandId: newCommandId(), leaseId }),
  setCap: (hostKey, cap) =>
    polaris().request("host.workers.setCap", { hostKey, commandId: newCommandId(), cap }),
};

let client: ResourcesClient = ipcClient;

/** Swaps the client: a preview's fake. */
export const setResourcesClient = (next: ResourcesClient) => {
  client = next;
};

export type ResourcesState =
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "loaded"; readonly snapshot: HostResourcesSnapshot };

/** One Host's resources, read when shown and again when its feed moves them (never polled). */
export const useHostResources = (hostKey: string) => {
  const [state, setState] = useState<ResourcesState>({ kind: "loading" });
  const live = useApp((s) => s.hostModels[hostKey]?.resources);

  useEffect(() => {
    let live = true;

    void client.get(hostKey).then((result) => {
      if (!live) return;
      setState(
        result.ok
          ? { kind: "loaded", snapshot: result.value }
          : { kind: "unavailable", reason: result.error.message }
      );
    });

    return () => {
      live = false;
    };
  }, [hostKey, live]);

  /** Runs a mutation; its answer replaces the snapshot, a refusal is toasted. */
  const run = useCallback(
    async (title: string, call: (c: ResourcesClient) => Promise<Result<HostResourcesSnapshot>>) => {
      const result = await call(client);

      if (result.ok) setState({ kind: "loaded", snapshot: result.value });
      else showRefusal(title, result.error);

      return result.ok;
    },
    []
  );

  return { state, run };
};
