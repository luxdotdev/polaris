/**
 * The app's Hosts as React state: one HostConnection per Host, shared by every screen. In
 * development the provider adds the dev bridge's Host from EXPO_PUBLIC_POLARIS_DEV_BRIDGE.
 */
import { Predicate } from "effect";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { devBridgeTransport, parseDevBridge } from "./devBridge.ts";
import {
  type HostConnection,
  type HostStatus,
  type HostTransport,
  type LiveHost,
  openHostConnection,
} from "./hostConnection.ts";

export interface HostRegistry {
  readonly hosts: ReadonlyArray<HostConnection>;
  /** Connects to a Host; replaces any connection already open for `hostId`. */
  readonly addHost: (hostId: string, name: string, transport: HostTransport) => void;
  readonly removeHost: (hostId: string) => void;
}

const Hosts = createContext<HostRegistry | null>(null);

const devHost = (): HostConnection | null => {
  if (!__DEV__) return null;
  // Read whole: Expo inlines EXPO_PUBLIC_ variables only where they are named in full.
  const value: unknown = process.env.EXPO_PUBLIC_POLARIS_DEV_BRIDGE;
  const bridge = Predicate.isString(value) ? parseDevBridge(value) : null;

  return bridge === null
    ? null
    : openHostConnection({
        hostId: bridge.hostId,
        name: "Dev Daemon",
        transport: devBridgeTransport(bridge),
      });
};

export const HostsProvider = ({ children }: { readonly children: ReactNode }) => {
  const [hosts, setHosts] = useState<ReadonlyArray<HostConnection>>([]);

  useEffect(() => {
    const dev = devHost();

    if (dev === null) return;
    setHosts((open) => [...open, dev]);

    return () => {
      setHosts((open) => open.filter((h) => h !== dev));
      void dev.close();
    };
  }, []);

  const registry = useMemo<HostRegistry>(
    () => ({
      hosts,
      addHost: (hostId, name, transport) => {
        const opened = openHostConnection({ hostId, name, transport });

        setHosts((open) => {
          for (const old of open) if (old.hostId === hostId) void old.close();

          return [...open.filter((h) => h.hostId !== hostId), opened];
        });
      },
      removeHost: (hostId) =>
        setHosts((open) => {
          for (const old of open) if (old.hostId === hostId) void old.close();

          return open.filter((h) => h.hostId !== hostId);
        }),
    }),
    [hosts]
  );

  return <Hosts.Provider value={registry}>{children}</Hosts.Provider>;
};

/** Development galleries: these Hosts in place of the app's, for the screens below. */
export const GalleryHosts = ({
  hosts,
  children,
}: {
  readonly hosts: ReadonlyArray<HostConnection>;
  readonly children: ReactNode;
}) => {
  const registry = useMemo<HostRegistry>(
    () => ({ hosts, addHost: () => undefined, removeHost: () => undefined }),
    [hosts]
  );

  return <Hosts.Provider value={registry}>{children}</Hosts.Provider>;
};

export const useHostRegistry = (): HostRegistry => {
  const registry = useContext(Hosts);

  if (registry === null) throw new Error("useHostRegistry needs a HostsProvider above it");

  return registry;
};

export const useHosts = (): ReadonlyArray<HostConnection> => useHostRegistry().hosts;

export const useHost = (hostId: string): HostConnection | null =>
  useHosts().find((h) => h.hostId === hostId) ?? null;

export const useHostStatus = (connection: HostConnection): HostStatus =>
  useSyncExternalStore(connection.subscribe, connection.status);

/** The live connection, or null while it is (re)connecting. */
export const useLiveHost = (connection: HostConnection | null): LiveHost | null =>
  useSyncExternalStore(
    connection?.subscribe ?? noSubscribe,
    connection === null ? noLive : connection.live
  );

const noSubscribe = () => () => {};

const noLive = () => null;
