/**
 * `constellation.stats` on demand: asked when the popover opens or the completion card shows,
 * cached per graph revision (the Daemon caches per revision too). No polling.
 */
import type { ConstellationId } from "@polaris/protocol";
import { useEffect, useState } from "react";
import type { ConstellationStatsView, IpcError } from "../../../shared/api.ts";
import { askStats } from "./statsClient.ts";

export type StatsState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly view: ConstellationStatsView }
  | { readonly kind: "error"; readonly error: IpcError };

export const useConstellationStats = (
  hostKey: string,
  constellationId: ConstellationId,
  revision: number,
  enabled: boolean
): StatsState => {
  const [state, setState] = useState<StatsState>({ kind: "loading" });

  useEffect(() => {
    if (!enabled) return;
    let live = true;

    setState({ kind: "loading" });
    void askStats(hostKey, constellationId, revision).then((result) => {
      if (live)
        setState(
          result.ok ? { kind: "ready", view: result.value } : { kind: "error", error: result.error }
        );
    });

    return () => {
      live = false;
    };
  }, [hostKey, constellationId, revision, enabled]);

  return state;
};
