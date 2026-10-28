/**
 * Every Host's Connection State and followed feed as React state, for Home, Hosts and the New
 * agent session sheet. One feed per Host while mounted; it waits out Reconnecting and Offline.
 */
import { useEffect, useState } from "react";
import type { HostConnection, HostStatus } from "../../runtime/hostConnection.ts";
import { useHosts } from "../../runtime/hosts.tsx";
import { type FollowedHost, followHost, unseenHost } from "./follow.ts";

export interface FollowedHostState {
  readonly connection: HostConnection;
  readonly status: HostStatus;
  readonly followed: FollowedHost;
}

export const useFollowedHosts = (): ReadonlyArray<FollowedHostState> => {
  const connections = useHosts();
  const [feeds, setFeeds] = useState<ReadonlyMap<string, FollowedHost>>(new Map());
  const [, setTick] = useState(0);

  useEffect(() => {
    const stops = connections.flatMap((connection) => [
      connection.subscribe(() => setTick((tick) => tick + 1)),
      followHost(connection, (followed) =>
        setFeeds((current) => new Map(current).set(connection.hostId, followed))
      ),
    ]);

    return () => {
      for (const stop of stops) stop();
    };
  }, [connections]);

  return connections.map((connection) => ({
    connection,
    status: connection.status(),
    followed: feeds.get(connection.hostId) ?? unseenHost,
  }));
};
