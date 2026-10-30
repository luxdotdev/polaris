/**
 * Host addresses in the Browser (ADR 0093): each Workspace's partition sends them to its
 * Host, through an authenticated HTTP proxy per remote Host whose connections become
 * Host-address streams.
 */
import { isHostAddress } from "@polaris/protocol";
import type { Effect, Fiber } from "effect";
import type { AuthInfo, Session } from "electron";
import { configurePartition, type PartitionRoute } from "./partition.ts";
import { PROXY_USER } from "./proxy.ts";
import { type OpenHostAddress, type ProxyServer, startProxyServer } from "./server.ts";

export interface ProxyCredentials {
  readonly username: string;
  readonly password: string;
}

export interface HostAddresses {
  /**
   * Sets up a Workspace's partition; `browser/views.ts` waits on it before every load. A
   * setup in flight or done is shared; a failed one is dropped, so the next call retries.
   */
  readonly configureBrowserSession: (hostKey: string, session: Session) => Promise<void>;
  /**
   * The credentials for a `login` event: only a proxy challenge from the partition's own
   * proxy, for a page in that partition. Anything else gets null and is cancelled.
   */
  readonly proxyLogin: (
    session: Session | undefined,
    authInfo: Pick<AuthInfo, "isProxy" | "host" | "port">
  ) => ProxyCredentials | null;
  /** Stops a removed Host's proxy; its partitions' Host addresses fail until set up again. */
  readonly forget: (hostKey: string) => Promise<void>;
  readonly dispose: () => Promise<void>;
}

export interface HostAddressesInput<R> {
  /** The Host's loopback is this machine's: the local Host, or one on a local socket. */
  readonly isLocal: (hostKey: string) => boolean;
  readonly open: (hostKey: string) => OpenHostAddress<R>;
  readonly run: (effect: Effect.Effect<void, never, R>) => Fiber.Fiber<void>;
  /** Applies a route to a partition; `configurePartition` outside tests. */
  readonly configure?: (session: Session, route: PartitionRoute) => Promise<void>;
}

interface Setup {
  readonly hostKey: string;
  readonly ready: Promise<void>;
}

export const createHostAddresses = <R>({
  isLocal,
  open,
  run,
  configure = (session, route) => configurePartition(session, route, isHostAddress),
}: HostAddressesInput<R>): HostAddresses => {
  const servers = new Map<string, Promise<ProxyServer>>();
  const started = new Map<string, ProxyServer>();
  const setups = new Map<Session, Setup>();

  const serverFor = (hostKey: string) => {
    let server = servers.get(hostKey);

    if (server === undefined) {
      const starting = startProxyServer({ open: open(hostKey), isHostAddress, run });

      server = starting;
      servers.set(hostKey, starting);
      starting.then(
        (value) => started.set(hostKey, value),
        () => servers.get(hostKey) === starting && servers.delete(hostKey)
      );
    }

    return server;
  };

  const setUp = async (hostKey: string, session: Session) =>
    configure(
      session,
      isLocal(hostKey)
        ? { kind: "local" }
        : { kind: "remote", proxyPort: (await serverFor(hostKey)).port }
    );

  const forget = async (hostKey: string) => {
    const server = servers.get(hostKey);

    servers.delete(hostKey);
    started.delete(hostKey);

    for (const [session, setup] of setups) if (setup.hostKey === hostKey) setups.delete(session);
    await (await server?.catch(() => null))?.close();
  };

  return {
    configureBrowserSession: (hostKey, session) => {
      const current = setups.get(session);

      if (current?.hostKey === hostKey) return current.ready;
      const ready = setUp(hostKey, session);

      setups.set(session, { hostKey, ready });
      ready.catch(() => {
        if (setups.get(session)?.ready === ready) setups.delete(session);
      });

      return ready;
    },
    proxyLogin: (session, authInfo) => {
      const setup = session === undefined ? undefined : setups.get(session);
      const server = setup === undefined ? undefined : started.get(setup.hostKey);

      if (server === undefined || !authInfo.isProxy) return null;

      return authInfo.host === "127.0.0.1" && authInfo.port === server.port
        ? { username: PROXY_USER, password: server.secret }
        : null;
    },
    forget,
    dispose: async () => {
      await Promise.all([...servers.keys()].map(forget));
    },
  };
};
