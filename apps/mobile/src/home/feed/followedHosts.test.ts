import { expect, test } from "bun:test";
import type { ClientBlobs, DaemonClient } from "@polaris/client/rpc";
import { HostId, HostInfo } from "@polaris/protocol";
import { Effect, Stream } from "effect";
import { readyToReview } from "../../review/ready.ts";
import type { HostConnection, HostStatus } from "../../runtime/hostConnection.ts";
import { session, snapshot, summary, synchronized } from "../fixtures.testing.ts";
import type { HomeHost } from "../model/home.ts";
import { type FollowedHostsStore, followedHostsStore } from "./followedHosts.ts";
import { homeHostsOf } from "./useFollowedHosts.ts";

const blobs: ClientBlobs = {
  offer: () => Effect.die("no blobs"),
  take: () => Effect.die("no blobs"),
  takeStream: () => Stream.die("no blobs"),
};

/** A connected Host whose client counts the host feeds opened on it. */
const connectedHost = (hostId: string) => {
  const feeds = { opened: 0 };

  const host = new HostInfo({
    hostId: HostId.make(hostId),
    hostname: hostId,
    platform: "darwin-arm64",
    daemonVersion: "0.0.0",
    homeDir: "/Users/lucas",
    startedAt: "2026-10-27T12:00:00.000Z",
  });

  const items = [
    snapshot({ sessions: [summary(session({ id: "ended", turnCount: 1 }))] }),
    synchronized(),
  ];

  const subscribeHost = () => {
    feeds.opened += 1;

    return Stream.concat(Stream.fromIterable(items), Stream.never);
  };

  // SAFETY: the feed subscribes as a Stream (AsQueue false), which is what this returns.
  const feedOnly = { subscribeHost: subscribeHost as DaemonClient["subscribeHost"] };
  // SAFETY: the host feed calls only subscribeHost; nothing else on the client is touched.
  const client = feedOnly as DaemonClient;
  const live = { epoch: 1, client, blobs, host, capabilities: [] };

  const status: HostStatus = {
    state: "connected",
    failure: null,
    attempt: 0,
    nextAttemptAt: null,
    host,
    capabilities: [],
    epoch: 1,
    latencyMs: null,
    lastSeenAt: null,
  };

  const connection: HostConnection = {
    hostId,
    name: hostId,
    route: "dev-bridge",
    status: () => status,
    live: () => live,
    subscribe: () => () => {},
    run: () => Promise.reject(new Error("not used")),
    retryNow: () => {},
    checkAlive: () => {},
    close: () => Promise.resolve(),
  };

  return { connection, feeds };
};

const until = async (check: () => boolean) => {
  for (let tries = 0; tries < 200 && !check(); tries++) await Bun.sleep(5);
};

/** A screen that reads the store, as useSyncExternalStore mounts it, and keeps what it shows. */
const mount = <A>(
  store: FollowedHostsStore,
  read: (hosts: ReadonlyArray<HomeHost>) => A,
  empty: A
) => {
  const screen = { shows: empty };

  const stop = store.subscribe(() => {
    screen.shows = read(homeHostsOf(store.snapshot()));
  });

  return { screen, stop };
};

const sessionIds = (hosts: ReadonlyArray<HomeHost>) =>
  hosts.flatMap((host) => [...host.followed.state.sessions.keys()]);

const readyCount = (hosts: ReadonlyArray<HomeHost>) => readyToReview(hosts).rows.length;

test("Home, the Review badge and the Review tab share one host feed per connected Host", async () => {
  const studio = connectedHost("studio");
  const store = followedHostsStore();
  const home = mount(store, sessionIds, []);
  const badge = mount(store, readyCount, 0);

  store.follow([studio.connection]);
  await until(() => badge.screen.shows === 1);

  expect(badge.screen.shows).toBe(1);
  expect(home.screen.shows).toEqual(["ended"]);
  expect(studio.feeds.opened).toBe(1);

  // The Review tab opens later, while the feeds already run.
  const tab = mount(store, readyCount, 0);
  const mini = connectedHost("mini");

  store.follow([studio.connection, mini.connection]);
  await until(() => badge.screen.shows === 2);

  expect(badge.screen.shows).toBe(2);
  expect(tab.screen.shows).toBe(2);
  expect([studio.feeds.opened, mini.feeds.opened]).toEqual([1, 1]);

  for (const screen of [home, badge, tab]) screen.stop();
  store.follow([]);
});
