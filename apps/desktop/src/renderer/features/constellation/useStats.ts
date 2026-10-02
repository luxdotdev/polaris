/**
 * `constellation.stats` on demand: asked when the popover opens or the completion card shows,
 * cached per graph revision (the Daemon caches per revision too). No polling.
 */
import type { ConstellationId } from "@polaris/protocol";
import { useEffect, useState } from "react";
import type { ConstellationStatsView, IpcError, Result } from "../../../shared/api.ts";
import { polaris } from "../bridge.ts";

export type StatsState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly view: ConstellationStatsView }
  | { readonly kind: "error"; readonly error: IpcError };

const cache = new Map<string, Promise<Result<ConstellationStatsView>>>();

const ask = (hostKey: string, constellationId: ConstellationId, revision: number) => {
  const key = `${hostKey}\u0000${constellationId}\u0000${revision}`;
  const known = cache.get(key);

  if (known !== undefined) return known;

  const asked = polaris()
    .request("constellation.stats", { hostKey, constellationId })
    .then((result) => {
      // A refusal or a dropped connection is asked again next time.
      if (!result.ok) cache.delete(key);

      return result;
    });

  cache.set(key, asked);

  return asked;
};

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
    void ask(hostKey, constellationId, revision).then((result) => {
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
