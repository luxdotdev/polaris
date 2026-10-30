import { afterEach, describe, expect, test } from "bun:test";
import { connect, createServer } from "node:net";
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
  const retired: Array<Session> = [];
  const state = { failing: false };

  hostAddresses = createHostAddresses<never>({
    isLocal: () => local,
    open: () => () => Effect.fail(502),
    run: (effect) => Effect.runFork(effect),
    configure: async (_session, route) => {
      routes.push(route);

      if (state.failing) throw new Error("setProxy failed");
    },
    retire: async (session) => {
      retired.push(session);
    },
  });

  return { hostAddresses, routes, retired, state };
};

const login = (port: number) => ({ isProxy: true, host: "127.0.0.1", port, realm: "Polaris" });

/** Whether another process could listen on `port` now. */
const canBind = (port: number) =>
  new Promise<boolean>((resolve) => {
    const other = createServer();

    other.once("error", () => resolve(false));
    other.listen(port, "127.0.0.1", () => other.close(() => resolve(true)));
  });

/** An authenticated CONNECT to a Host address on `port`, and whatever comes back. */
const connectTo = (port: number, secret: string) =>
  new Promise<string>((resolve) => {
    const credential = Buffer.from(`polaris:${secret}`).toString("base64");

    const socket = connect(port, "127.0.0.1", () =>
      socket.write(
        `CONNECT localhost:3000 HTTP/1.1\r\nProxy-Authorization: Basic ${credential}\r\n\r\n`
      )
    );

    let received = "";

    socket.on("data", (chunk) => (received += Buffer.from(chunk).toString()));
    socket.on("error", () => {});
    socket.on("close", () => resolve(received));
    setTimeout(() => socket.destroy(), 500);
  });

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

  test("a removed Host's partitions lose their rules, and its port stays held until they move", async () => {
    const { hostAddresses, routes, retired } = setup();
    const session = fakeSession();

    await hostAddresses.configureBrowserSession("rpi", session);
    const before = portOf(routes[0]);
    const secret = hostAddresses.proxyLogin(session, login(before))?.password ?? "";

    await hostAddresses.forget("rpi");

    const whileRetired = {
      retired: retired.includes(session),
      bindable: await canBind(before),
      answer: await connectTo(before, secret),
    };

    await hostAddresses.configureBrowserSession("rpi", session);

    expect(whileRetired).toEqual({ retired: true, bindable: false, answer: "" });
    expect(portOf(routes[1])).not.toBe(before);
    expect(await canBind(before)).toBe(true);
  });
});

describe("the proxy's login", () => {
  test("only the partition's own proxy challenge gets the credentials", async () => {
    const { hostAddresses, routes } = setup();
    const session = fakeSession();
    const other = fakeSession();

    await hostAddresses.configureBrowserSession("rpi", session);
    const port = portOf(routes[0]);
    const proxy = login(port);

    expect(hostAddresses.proxyLogin(session, proxy)?.username).toBe("polaris");
    expect(hostAddresses.proxyLogin(session, proxy)?.password.length).toBeGreaterThanOrEqual(32);
    expect([
      hostAddresses.proxyLogin(other, proxy),
      hostAddresses.proxyLogin(undefined, proxy),
      hostAddresses.proxyLogin(session, { ...proxy, isProxy: false }),
      hostAddresses.proxyLogin(session, { ...proxy, port: port + 1 }),
      hostAddresses.proxyLogin(session, { ...proxy, host: "app.localhost" }),
      hostAddresses.proxyLogin(session, { ...proxy, realm: "upstream" }),
    ]).toEqual([null, null, null, null, null, null]);
  });

  test("a partition on this machine's Host goes direct and has no proxy to answer", async () => {
    const { hostAddresses, routes } = setup(true);
    const session = fakeSession();

    await hostAddresses.configureBrowserSession("local", session);

    expect(routes).toEqual([{ kind: "local" }]);
    expect(
      hostAddresses.proxyLogin(session, {
        isProxy: true,
        host: "127.0.0.1",
        port: 1,
        realm: "Polaris",
      })
    ).toBe(null);
  });
});
