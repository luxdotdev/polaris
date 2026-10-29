/**
 * A HostConnection over the thread tests' fake Host (`daemon.testing.ts`), for the thread gallery:
 * a dataset's Snapshot and live items, and a switch that drops the connection and brings it back.
 */
import type { DaemonClient } from "@polaris/client/rpc";
import { HostId, HostInfo, Timestamp } from "@polaris/protocol";
import { Effect, Exit, Scope, Stream } from "effect";
import type { HostConnection, HostStatus, LiveHost } from "../runtime/hostConnection.ts";
import { NotConnected } from "../runtime/hostConnection.ts";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- dev gallery: the tests' fake Host has no Layer.
import { makeFakeHost } from "./daemon.testing.ts";
import { type GalleryData, snapshotOf } from "./worstCase.testing.ts";

export interface GalleryHost {
  readonly connection: HostConnection;
  readonly setLive: (live: boolean) => void;
  readonly close: () => void;
}

const NO_BLOBS: LiveHost["blobs"] = {
  offer: () => Effect.die("The gallery's Host takes no blobs"),
  take: () => Effect.die("The gallery's Host has no blobs"),
  takeStream: () => Stream.die("The gallery's Host has no blobs"),
};

export const galleryHost = async (
  hostId: string,
  name: string,
  data: GalleryData
): Promise<GalleryHost> => {
  const scope = Scope.makeUnsafe();

  const fake = await Effect.runPromise(
    makeFakeHost({ workspaceName: data.workspaceName }).pipe(Scope.provide(scope))
  );

  const { client } = await Effect.runPromise(fake.live.next(0));
  await Effect.runPromise(fake.push(snapshotOf(data)));

  for (const item of data.live) await Effect.runPromise(fake.push(item));

  const host = new HostInfo({
    hostId: HostId.make(hostId),
    hostname: name,
    platform: "darwin",
    daemonVersion: "0.2.0",
    homeDir: "/Users/aleksandra",
    startedAt: Timestamp.make("2026-10-27T09:00:00.000Z"),
  });

  const live: LiveHost = {
    epoch: 1,
    // SAFETY: the thread calls only ThreadRpcs, which the fake answers; DaemonClient is their superset.
    client: client as DaemonClient,
    blobs: NO_BLOBS,
    host,
    capabilities: ["session.steer", "session.continuity", "session.live-items"],
  };

  const listeners = new Set<() => void>();
  let on = true;

  const status = (): HostStatus => ({
    state: on ? "connected" : "reconnecting",
    failure: null,
    attempt: on ? 0 : 3,
    nextAttemptAt: null,
    host,
    capabilities: live.capabilities,
    epoch: 1,
    latencyMs: on ? 12 : null,
    lastSeenAt: null,
  });

  const connection: HostConnection = {
    hostId,
    name,
    route: "dev-bridge",
    status,
    live: () => (on ? live : null),
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    run: (use) =>
      on ? Effect.runPromise(use(live.client)) : Promise.reject(new NotConnected(hostId)),
    retryNow: () => undefined,
    checkAlive: () => undefined,
    close: () => Promise.resolve(),
  };

  return {
    connection,
    setLive: (next) => {
      on = next;
      listeners.forEach((listener) => listener());
    },
    close: () => void Effect.runPromise(Scope.close(scope, Exit.void)),
  };
};
