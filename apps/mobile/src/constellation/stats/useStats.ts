/**
 * A constellation's `constellation.stats` over the Host's shared connection, read again when its
 * revision moves. Cost is what the Harnesses reported; the phone keeps no price table.
 */
import { ConstellationId, type ConstellationStats } from "@polaris/protocol";
import { Effect } from "effect";
import { useEffect, useState } from "react";
import type { HostConnection } from "../../runtime/hostConnection.ts";
import { useLiveHost } from "../../runtime/hosts.tsx";

export type StatsState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly stats: ConstellationStats }
  | { readonly kind: "failed"; readonly message: string };

/** An older Host refuses a phone `constellation.stats` (NotGranted); the Host's words when it says. */
export const STATS_UNAVAILABLE = "This host needs a newer Polaris to share stats with your phone.";

export const useConstellationStats = (
  connection: HostConnection | null,
  constellationId: string,
  revision: number,
  enabled = true
): StatsState => {
  const live = useLiveHost(connection);
  const [state, setState] = useState<StatsState>({ kind: "loading" });

  useEffect(() => {
    if (live === null || !enabled) return;
    let current = true;

    void Effect.runPromise(
      live.client["constellation.stats"]({
        constellationId: ConstellationId.make(constellationId),
      }).pipe(
        Effect.map((stats): StatsState => ({ kind: "ready", stats })),
        Effect.catchTag("ConstellationRejected", (e) =>
          Effect.succeed<StatsState>({
            kind: "failed",
            message: e.findings[0]?.message ?? STATS_UNAVAILABLE,
          })
        ),
        Effect.orElseSucceed((): StatsState => ({ kind: "failed", message: STATS_UNAVAILABLE }))
      )
    ).then((next) => {
      if (current) setState(next);
    });

    return () => {
      current = false;
    };
  }, [live, constellationId, revision, enabled]);

  return state;
};
