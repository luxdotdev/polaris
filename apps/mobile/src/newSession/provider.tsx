/**
 * The sheet's data from the app's HostConnections (src/runtime/hosts.tsx) and the Hosts'
 * workspaces and sessions, which the home feed folds and passes in as `feeds`.
 */
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { HostConnection } from "../runtime/hostConnection.ts";
import { useHosts } from "../runtime/hosts.tsx";
import { NewSessionDataContext } from "./api.ts";
import { type HostFeed, newSessionApi, sheetHost } from "./connect.ts";

/** Renders again whenever any connection's status changes. */
const useStatusChanges = (hosts: ReadonlyArray<HostConnection>): void => {
  const [, setTick] = useState(0);

  useEffect(() => {
    const stops = hosts.map((h) => h.subscribe(() => setTick((n) => n + 1)));

    return () => {
      for (const stop of stops) stop();
    };
  }, [hosts]);
};

export const NewSessionDataProvider = ({
  feeds,
  children,
}: {
  readonly feeds: ReadonlyMap<string, HostFeed>;
  readonly children: ReactNode;
}) => {
  const hosts = useHosts();

  useStatusChanges(hosts);
  const api = useMemo(() => newSessionApi(hosts), [hosts]);
  const value = { api, hosts: hosts.map((h) => sheetHost(h, feeds.get(h.hostId) ?? null)) };

  return <NewSessionDataContext.Provider value={value}>{children}</NewSessionDataContext.Provider>;
};
