/**
 * Host stats on a Client (ENG-565): `host.stats.watch` where the Daemon has
 * `host.stats`, and a fold into the window of samples a sparkline draws.
 */
import {
  HOST_STATS_HISTORY,
  HostStatsItem,
  type HostStatsSample,
  type Unsupported,
} from "@polaris/protocol";
import { Stream } from "effect";
import type { RpcClientError } from "effect/rpc/RpcClientError";
import type { LiveSession } from "./HostConnection.ts";

/** What watching reads of a live connection. */
export type HostStatsSession = Pick<LiveSession, "capabilities"> & {
  readonly client: {
    readonly "host.stats.watch": (
      payload: Record<string, never>
    ) => Stream.Stream<HostStatsItem, Unsupported | RpcClientError>;
  };
};

export const supportsHostStats = (session: Pick<LiveSession, "capabilities">): boolean =>
  session.capabilities.includes("host.stats");

/**
 * `History`, then a `Sample` per interval while the stream runs. On a Daemon
 * without `host.stats` it ends at once, empty, and nothing is asked of the Daemon.
 */
export const watchHostStats = (
  session: HostStatsSession
): Stream.Stream<HostStatsItem, Unsupported | RpcClientError> =>
  supportsHostStats(session) ? session.client["host.stats.watch"]({}) : Stream.empty;

export interface HostStatsWindow {
  /** Null until the first `History`. */
  readonly cores: number | null;
  readonly intervalMs: number | null;
  /** Oldest first, at most HOST_STATS_HISTORY. */
  readonly samples: ReadonlyArray<HostStatsSample>;
}

export const emptyHostStats: HostStatsWindow = { cores: null, intervalMs: null, samples: [] };

/** A `History` replaces the window (a resubscribe after a reconnect); a `Sample` slides it on. */
export const applyHostStats = (window: HostStatsWindow, item: HostStatsItem): HostStatsWindow =>
  HostStatsItem.match(item, {
    History: ({ cores, intervalMs, samples }) => ({
      cores,
      intervalMs,
      samples: samples.slice(-HOST_STATS_HISTORY),
    }),
    Sample: ({ sample }) => ({
      ...window,
      samples: [...window.samples, sample].slice(-HOST_STATS_HISTORY),
    }),
  });
