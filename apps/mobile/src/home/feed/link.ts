/**
 * What Home needs from one Host's connection: the part of `src/runtime`'s HostConnection it
 * reads, so the feed and its tests need no transport.
 */
import type { DaemonClient } from "@polaris/client/rpc";
import type { LiveSource } from "@polaris/client/resume";
import { Effect } from "effect";
import type { HostConnection, LiveHost } from "../../runtime/hostConnection.ts";

export type HostLink = Pick<
  HostConnection,
  "hostId" | "name" | "route" | "status" | "live" | "subscribe"
>;

/** The link as a resumable feed's source: waits, however long, for a live connection. */
export const liveSourceOf = (link: HostLink): LiveSource<DaemonClient> => ({
  next: (minEpoch) =>
    Effect.callback<LiveHost>((resume) => {
      const check = () => {
        const live = link.live();

        if (live === null || live.epoch < minEpoch) return false;
        resume(Effect.succeed(live));

        return true;
      };

      if (check()) return;

      const unsubscribe = link.subscribe(() => {
        if (check()) unsubscribe();
      });

      return Effect.sync(unsubscribe);
    }),
});
