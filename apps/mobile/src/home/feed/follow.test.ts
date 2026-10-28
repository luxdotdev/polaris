import { expect, test } from "bun:test";
import type { DaemonClient } from "@polaris/client/rpc";
import { HostId, HostInfo, type HostStreamItem } from "@polaris/protocol";
import { Stream } from "effect";
import { session, snapshot, summary, synchronized } from "../fixtures.testing.ts";
import { type FollowedHost, followHost } from "./follow.ts";
import type { HostStatus, LiveHost } from "../../runtime/hostConnection.ts";
import type { HostLink } from "./link.ts";

const hostInfo = new HostInfo({
  hostId: HostId.make("h1"),
  hostname: "studio",
  platform: "darwin-arm64",
  daemonVersion: "0.0.0",
  homeDir: "/Users/lucas",
  startedAt: "2026-10-27T12:00:00.000Z",
});

/** A Host whose connection the test brings up and down, as the runtime's HostConnection would. */
const fakeLink = () => {
  const listeners = new Set<() => void>();
  let live: LiveHost | null = null;

  let status: HostStatus = {
    state: "offline",
    failure: null,
    attempt: 1,
    nextAttemptAt: null,
    host: null,
    capabilities: [],
    epoch: 0,
    latencyMs: null,
    lastSeenAt: null,
  };

  const link: HostLink = {
    hostId: "h1",
    name: "Mac Studio",
    route: "dev-bridge",
    status: () => status,
    live: () => live,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };

  const connect = (epoch: number, items: ReadonlyArray<HostStreamItem>) => {
    const stream = () => Stream.concat(Stream.fromIterable(items), Stream.never);
    // SAFETY: the feed subscribes as a Stream (AsQueue false), which is what this returns.
    const feedOnly = { subscribeHost: stream as DaemonClient["subscribeHost"] };
    // SAFETY: the host feed calls only subscribeHost; nothing else on the client is touched.
    const client = feedOnly as DaemonClient;

    // SAFETY: the host feed never sends or takes a blob.
    const blobs = {} as LiveHost["blobs"];

    live = { epoch, client, blobs, host: hostInfo, capabilities: [] };
    status = { ...status, state: "connected", epoch };

    for (const listener of listeners) listener();
  };

  return { link, connect };
};

const until = async (check: () => boolean) => {
  for (let tries = 0; tries < 200 && !check(); tries++) await Bun.sleep(5);
};

test("a Host that is offline when Home opens is followed once it connects", async () => {
  const { link, connect } = fakeLink();
  let latest: FollowedHost | null = null;

  const stop = followHost(link, (followed) => {
    latest = followed;
  });

  await Bun.sleep(20);
  expect(latest).toBeNull();

  connect(1, [
    snapshot({ sessions: [summary(session({ id: "s1", state: "working" }))] }),
    synchronized(),
  ]);
  await until(() => latest?.state.synchronized === true);
  stop();

  expect(latest).not.toBeNull();
  const followed: FollowedHost = latest!;

  expect(followed.seen).toBe(true);
  expect([...followed.state.sessions.keys()]).toEqual(["s1"]);
});
