/**
 * The thread's source on a Host's shared connection (`src/runtime`): feeds and
 * calls wait for a live connection and reopen on the next one after a drop.
 */
import type { LiveSource } from "@polaris/client/resume";
import { Effect } from "effect";
import type { HostConnection, LiveHost } from "../runtime/hostConnection.ts";
import { teammateThreadSource } from "../shared/source.ts";
import { daemonThreadSource, type ThreadClient, type ThreadSource } from "./source.ts";

/** Waits for the connection's live client at `minEpoch` or later. */
export const liveSourceOf = (connection: HostConnection): LiveSource<ThreadClient> => ({
  next: (minEpoch) =>
    Effect.callback<{ readonly epoch: number; readonly client: ThreadClient }>((resume) => {
      const check = () => {
        const live = connection.live();

        if (live === null || live.epoch < minEpoch) return false;
        resume(Effect.succeed({ epoch: live.epoch, client: live.client }));

        return true;
      };

      if (check()) return;

      const stop = connection.subscribe(() => {
        if (check()) stop();
      });

      return Effect.sync(stop);
    }),
});

/** A Teammate's connection gets the shared source: only what a Share allows. */
export const hostThreadSource = (connection: HostConnection, live: LiveHost): ThreadSource =>
  connection.teammate === null
    ? daemonThreadSource({
        live: liveSourceOf(connection),
        capabilities: new Set(live.capabilities),
      })
    : teammateThreadSource(liveSourceOf(connection), new Set(live.capabilities));
