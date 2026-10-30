/**
 * Host addresses in the Browser (ADR 0093): each Workspace's partition sends them to its
 * Host, over a SOCKS server per remote Host whose connections become Host-address streams.
 */
import { isHostAddress } from "@polaris/protocol";
import type { Effect, Fiber } from "effect";
import type { Session } from "electron";
import { configurePartition } from "./partition.ts";
import { type OpenHostAddress, type SocksServer, startSocksServer } from "./server.ts";

export interface HostAddresses {
  /**
   * Sets up a Workspace's partition before its first page loads (`browser/views.ts` calls it
   * once each): Host addresses to the Host, directly for this machine's, and their certificates.
   */
  readonly configureBrowserSession: (hostKey: string, session: Session) => Promise<void>;
  readonly dispose: () => Promise<void>;
}

export interface HostAddressesInput<R> {
  /** The Host's loopback is this machine's: the local Host, or one on a local socket. */
  readonly isLocal: (hostKey: string) => boolean;
  readonly open: (hostKey: string) => OpenHostAddress<R>;
  readonly run: (effect: Effect.Effect<void, never, R>) => Fiber.Fiber<void>;
}

export const createHostAddresses = <R>({
  isLocal,
  open,
  run,
}: HostAddressesInput<R>): HostAddresses => {
  const servers = new Map<string, Promise<SocksServer>>();

  const serverFor = (hostKey: string) => {
    let server = servers.get(hostKey);

    if (server === undefined) {
      server = startSocksServer({ open: open(hostKey), isHostAddress, run });
      servers.set(hostKey, server);
    }

    return server;
  };

  return {
    configureBrowserSession: async (hostKey, session) =>
      configurePartition(
        session,
        isLocal(hostKey)
          ? { kind: "local" }
          : { kind: "remote", socksPort: (await serverFor(hostKey)).port },
        isHostAddress
      ),
    dispose: async () => {
      const started = [...servers.values()];

      servers.clear();
      await Promise.all(started.map(async (server) => (await server).close()));
    },
  };
};
