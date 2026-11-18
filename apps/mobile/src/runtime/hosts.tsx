/**
 * The app's Hosts as React state: one HostConnection per Host, shared by every screen. In
 * development the provider adds the dev bridge's Host from EXPO_PUBLIC_POLARIS_DEV_BRIDGE.
 * Hosts shared with this person as a Teammate are kept apart: only their threads open them.
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
  type HostConnectionOptions,
  type HostStatus,
  type HostTransport,
  type LiveHost,
  openHostConnection,
} from "./hostConnection.ts";

/** What a Teammate's connection adds: its statement and who they are on that Host. */
export type SharedOptions = Required<Pick<HostConnectionOptions, "accountStatement" | "teammate">>;

export interface HostRegistry {
  /** The user's own Hosts. */
  readonly hosts: ReadonlyArray<HostConnection>;
  /** Hosts shared with the user as a Teammate, keyed by their Share's key. */
  readonly shared: ReadonlyArray<HostConnection>;
  /**
   * Connects to a Host; replaces any connection already open for `hostId`. With `shared` it is a
   * Teammate's connection, kept out of `hosts`.
   */
  readonly addHost: (
    hostId: string,
    name: string,
    transport: HostTransport,
    shared?: SharedOptions
  ) => void;
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
      hosts: hosts.filter((h) => h.teammate === null),
      shared: hosts.filter((h) => h.teammate !== null),
      addHost: (hostId, name, transport, shared) => {
        const opened = openHostConnection({ hostId, name, transport, ...shared });

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
    () => ({ hosts, shared: [], addHost: () => undefined, removeHost: () => undefined }),
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

/** One of the user's Hosts, or one shared with them, by its id or Share key. */
export const useHost = (hostId: string): HostConnection | null => {
  const { hosts, shared } = useHostRegistry();

  return hosts.find((h) => h.hostId === hostId) ?? shared.find((h) => h.hostId === hostId) ?? null;
};

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
