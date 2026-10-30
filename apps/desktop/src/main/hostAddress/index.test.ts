import { afterEach, describe, expect, test } from "bun:test";
import { connect } from "node:net";
import { Effect } from "effect";
import type { Session } from "electron";
import { createHostAddresses, type HostAddresses } from "./index.ts";
import type { PartitionRoute } from "./partition.ts";

// SAFETY: the fake configure below never touches the session; only its identity matters.
const fakeSession = () => ({}) as Session;

let hostAddresses: HostAddresses | null = null;

afterEach(async () => {
  await hostAddresses?.dispose();
  hostAddresses = null;
});

/** Host addresses whose partition setup fails while `failing` holds, recording each route. */
const setup = (local = false) => {
  const routes: Array<PartitionRoute> = [];
  const state = { failing: false };

  hostAddresses = createHostAddresses<never>({
    isLocal: () => local,
    open: () => () => Effect.fail(502),
    run: (effect) => Effect.runFork(effect),
    configure: async (_session, route) => {
      routes.push(route);

      if (state.failing) throw new Error("setProxy failed");
    },
  });

  return { hostAddresses, routes, state };
};

const portOf = (route: PartitionRoute | undefined) =>
  route?.kind === "remote" ? route.proxyPort : -1;

describe("a partition's setup", () => {
  test("a failed setup rejects, isn't kept, and the next load sets it up again", async () => {
    const { hostAddresses, routes, state } = setup();
    const session = fakeSession();

    state.failing = true;

    const failure = await hostAddresses.configureBrowserSession("rpi", session).then(
      () => null,
      (error: Error) => error.message
    );

    state.failing = false;
    await hostAddresses.configureBrowserSession("rpi", session);
    await hostAddresses.configureBrowserSession("rpi", session);

    expect(failure).toBe("setProxy failed");
    expect(routes.map((route) => route.kind)).toEqual(["remote", "remote"]);
  });

  test("a removed Host's proxy stops, and its partitions are set up on a new one", async () => {
    const { hostAddresses, routes } = setup();
    const session = fakeSession();

    await hostAddresses.configureBrowserSession("rpi", session);
    const before = portOf(routes[0]);

    await hostAddresses.forget("rpi");

    const refused = await new Promise((resolve) => {
      const probe = connect(before, "127.0.0.1");

      probe.once("connect", () => resolve(probe.destroy() && false));
      probe.once("error", () => resolve(true));
    });

    await hostAddresses.configureBrowserSession("rpi", session);

    expect(refused).toBe(true);
    expect(routes).toHaveLength(2);
    expect(portOf(routes[1])).not.toBe(before);
  });
});

describe("the proxy's login", () => {
  test("only the partition's own proxy challenge gets the credentials", async () => {
    const { hostAddresses, routes } = setup();
    const session = fakeSession();
    const other = fakeSession();

    await hostAddresses.configureBrowserSession("rpi", session);
    const port = portOf(routes[0]);
    const proxy = { isProxy: true, host: "127.0.0.1", port };

    expect(hostAddresses.proxyLogin(session, proxy)?.username).toBe("polaris");
    expect(hostAddresses.proxyLogin(session, proxy)?.password.length).toBeGreaterThanOrEqual(32);
    expect([
      hostAddresses.proxyLogin(other, proxy),
      hostAddresses.proxyLogin(undefined, proxy),
      hostAddresses.proxyLogin(session, { ...proxy, isProxy: false }),
      hostAddresses.proxyLogin(session, { ...proxy, port: port + 1 }),
      hostAddresses.proxyLogin(session, { ...proxy, host: "app.localhost" }),
    ]).toEqual([null, null, null, null, null]);
  });

  test("a partition on this machine's Host goes direct and has no proxy to answer", async () => {
    const { hostAddresses, routes } = setup(true);
    const session = fakeSession();

    await hostAddresses.configureBrowserSession("local", session);

    expect(routes).toEqual([{ kind: "local" }]);
    expect(hostAddresses.proxyLogin(session, { isProxy: true, host: "127.0.0.1", port: 1 })).toBe(
      null
    );
  });
});
