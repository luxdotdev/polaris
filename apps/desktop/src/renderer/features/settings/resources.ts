/**
 * Settings → Hosts' resources and worker cap, over C1-R's RPCs (`host.resources.get`,
 * `.declare`, `.remove`, `.release`, `host.workers.setCap`); every call answers with the
 * Host's whole snapshot. Pluggable: the IPC bridge lands with R's handlers, previews fake it.
 */
import { useCallback, useEffect, useState } from "react";
import type { Result } from "../../../shared/api.ts";
import { showRefusal } from "../session/dispatch.ts";
import type { HostResourcesSnapshot } from "./model/resources.ts";

export interface ResourcesClient {
  readonly get: (hostKey: string) => Promise<Result<HostResourcesSnapshot>>;
  readonly declare: (
    hostKey: string,
    input: { readonly name: string; readonly capacity: number; readonly holdLimitMs?: number }
  ) => Promise<Result<HostResourcesSnapshot>>;
  readonly remove: (hostKey: string, name: string) => Promise<Result<HostResourcesSnapshot>>;
  readonly release: (hostKey: string, leaseId: string) => Promise<Result<HostResourcesSnapshot>>;
  readonly setCap: (hostKey: string, cap: number | null) => Promise<Result<HostResourcesSnapshot>>;
}

const unavailable = (): Promise<Result<HostResourcesSnapshot>> =>
  Promise.resolve({
    ok: false,
    error: { code: "Unsupported", message: "This host's daemon doesn't manage resources yet." },
  });

let client: ResourcesClient = {
  get: unavailable,
  declare: unavailable,
  remove: unavailable,
  release: unavailable,
  setCap: unavailable,
};

/** Swaps the client: the IPC one once R's handlers are bridged, or a preview's fake. */
export const setResourcesClient = (next: ResourcesClient) => {
  client = next;
};

export type ResourcesState =
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable"; readonly reason: string }
  | { readonly kind: "loaded"; readonly snapshot: HostResourcesSnapshot };

/** One Host's resources, read when shown (no polling: an idle app stays idle). */
export const useHostResources = (hostKey: string) => {
  const [state, setState] = useState<ResourcesState>({ kind: "loading" });

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
  }, [hostKey]);

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
