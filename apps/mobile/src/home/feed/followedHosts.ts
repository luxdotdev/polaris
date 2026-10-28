/**
 * Every Host's Connection State and followed feed in one store: one followHost per connection,
 * however many screens read it. Screens read it through `useFollowedHosts`.
 */
import type { HostConnection, HostStatus } from "../../runtime/hostConnection.ts";
import { type FollowedHost, followHost, unseenHost } from "./follow.ts";

export interface FollowedHostState {
  readonly connection: HostConnection;
  readonly status: HostStatus;
  readonly followed: FollowedHost;
}

export interface FollowedHostsStore {
  /** Follows the connections not yet followed and stops the ones no longer listed. */
  readonly follow: (connections: ReadonlyArray<HostConnection>) => void;
  readonly subscribe: (listener: () => void) => () => void;
  /** The same array until a status or feed changes, as useSyncExternalStore requires. */
  readonly snapshot: () => ReadonlyArray<FollowedHostState>;
}

interface Following {
  stop: () => void;
  followed: FollowedHost;
}

export const followedHostsStore = (): FollowedHostsStore => {
  const listeners = new Set<() => void>();
  const following = new Map<HostConnection, Following>();
  let connections: ReadonlyArray<HostConnection> = [];
  let current: ReadonlyArray<FollowedHostState> = [];

  const publish = () => {
    current = connections.map((connection) => ({
      connection,
      status: connection.status(),
      followed: following.get(connection)?.followed ?? unseenHost,
    }));

    for (const listener of listeners) listener();
  };

  const start = (connection: HostConnection): Following => {
    const entry: Following = { stop: () => {}, followed: unseenHost };

    const stopStatus = connection.subscribe(publish);

    const stopFeed = followHost(connection, (followed) => {
      entry.followed = followed;
      publish();
    });

    entry.stop = () => {
      stopStatus();
      stopFeed();
    };

    return entry;
  };

  return {
    follow: (next) => {
      for (const [connection, entry] of following) {
        if (next.includes(connection)) continue;
        entry.stop();
        following.delete(connection);
      }

      for (const connection of next) {
        if (!following.has(connection)) following.set(connection, start(connection));
      }

      connections = next;
      publish();
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    snapshot: () => current,
  };
};
