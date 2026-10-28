/**
 * Every Host's Connection State and followed feed as React state, for Home, Hosts, the New agent
 * session sheet and the widgets. One feed per Host for the app's life; it waits out Reconnecting
 * and Offline.
 */
import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import type { HostConnection, HostStatus } from "../../runtime/hostConnection.ts";
import { useHosts } from "../../runtime/hosts.tsx";
import type { HomeHost } from "../model/home.ts";
import { type FollowedHost, followHost, unseenHost } from "./follow.ts";

export interface FollowedHostState {
  readonly connection: HostConnection;
  readonly status: HostStatus;
  readonly followed: FollowedHost;
}

const FollowedHosts = createContext<ReadonlyArray<FollowedHostState> | null>(null);

const useFollowing = (): ReadonlyArray<FollowedHostState> => {
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

/** Follows every Host once, under the screens, so leaving Home doesn't drop the feeds. */
export const FollowedHostsProvider = ({ children }: { readonly children: ReactNode }) =>
  createElement(FollowedHosts.Provider, { value: useFollowing() }, children);

export const useFollowedHosts = (): ReadonlyArray<FollowedHostState> => {
  const hosts = useContext(FollowedHosts);

  if (hosts === null) throw new Error("useFollowedHosts needs a FollowedHostsProvider above it");

  return hosts;
};

/** The followed Hosts as Home's model reads them, named by their hostname once it is known. */
export const homeHostsOf = (hosts: ReadonlyArray<FollowedHostState>): ReadonlyArray<HomeHost> =>
  hosts.map(({ connection, status, followed }) => ({
    hostId: connection.hostId,
    name: status.host?.hostname ?? connection.name,
    connection: status.state,
    followed,
  }));
