/**
 * `constellation.stats` per Constellation for Usage → By constellation, asked of each Lead's
 * Host while the page shows and again when a graph's revision moves (never polled).
 */
import { useEffect, useState } from "react";
import type { ConstellationStatsView } from "../../../shared/api.ts";
import { useApp } from "../../shell/hooks.ts";
import { askStats } from "../constellation/statsClient.ts";
import type { ConstellationView } from "../sessions/source.ts";

interface Wanted {
  readonly hostKey: string;
  readonly id: string;
  readonly revision: number;
}

export const useConstellationStats = (
  views: ReadonlyArray<ConstellationView>
): ReadonlyMap<string, ConstellationStatsView> => {
  const hosts = useApp((s) => s.hosts);
  const [stats, setStats] = useState<ReadonlyMap<string, ConstellationStatsView>>(new Map());

  // Each Constellation's Lead Host and revision, as a string, so the effect runs when one moves.
  const key = JSON.stringify(
    views.flatMap((v): Array<Wanted> => {
      const host = hosts.find(
        (h) => h.status.state === "connected" && h.status.host?.hostId === v.constellation.hostId
      );

      return host === undefined
        ? []
        : [{ hostKey: host.key, id: v.constellation.id, revision: v.constellation.revision }];
    })
  );

  useEffect(() => {
    let live = true;
    // SAFETY: `key` is this hook's own JSON of an Array<Wanted>.
    const wanted = JSON.parse(key) as ReadonlyArray<Wanted>;

    void Promise.all(
      wanted.map(async (w) => {
        // SAFETY: the id came from the Constellation's own record.
        const id = w.id as ConstellationView["constellation"]["id"];
        const result = await askStats(w.hostKey, id, w.revision);

        return result.ok ? ([w.id, result.value] as const) : null;
      })
    ).then((answers) => {
      if (live) setStats(new Map(answers.filter((a) => a !== null)));
    });

    return () => {
      live = false;
    };
  }, [key]);

  return stats;
};
