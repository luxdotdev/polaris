import { launchDaemon, type TestDaemon } from "@polaris/sdk/testing";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { startDevBridge, type DevBridgeServer } from "./devBridge.ts";
import {
  devBridgeTransport,
  devBridgeUrl,
  formatDevBridge,
  parseDevBridge,
} from "../src/runtime/devBridge.ts";
import {
  type HostConnection,
  type HostStatus,
  NotConnected,
  openHostConnection,
} from "../src/runtime/hostConnection.ts";

let daemon: TestDaemon;

let bridge: DevBridgeServer;

beforeAll(async () => {
  daemon = await launchDaemon();
  bridge = startDevBridge(daemon.socketPath);
}, 60_000);

afterAll(async () => {
  bridge.stop();
  await daemon.stop();
});

const until = (connection: HostConnection, done: (status: HostStatus) => boolean) =>
  new Promise<HostStatus>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), 20_000);

    const check = () => {
      const status = connection.status();

      if (!done(status)) return;
      clearTimeout(timer);
      stop();
      resolve(status);
    };

    const stop = connection.subscribe(check);

    check();
  });

const open = (token: string) =>
  openHostConnection({
    hostId: daemon.hostId,
    name: "Dev Daemon",
    transport: devBridgeTransport({ hostId: daemon.hostId, port: bridge.port, token }),
  });

test("the printed bridge string round-trips", () => {
  const printed = { hostId: daemon.hostId, port: bridge.port, token: bridge.token };

  expect(parseDevBridge(formatDevBridge(printed))).toEqual(printed);
  expect(parseDevBridge("polaris-dev-bridge:v1:7600::host")).toBeNull();
});

test("over the bridge the app is a Client: Client-only RPCs answer", async () => {
  const connection = open(bridge.token);

  try {
    const status = await until(connection, (s) => s.state === "connected");

    expect(status.host?.hostId).toBe(daemon.hostId);
    // An Extension pairing is refused this one (NotGranted); a Client is not.
    const defaults = await connection.run((client) => client["constellation.defaults.get"]({}));

    expect(defaults.settings).toBeInstanceOf(Object);
  } finally {
    await connection.close();
  }
}, 30_000);

test("a wrong token never connects", async () => {
  const connection = open("not-the-token");

  try {
    const status = await until(connection, (s) => s.attempt > 0);

    expect(status.state).toBe("reconnecting");
    expect(status.failure?.reason).toBe("unreachable");
    expect(connection.live()).toBeNull();

    const refused = await connection
      .run((client) => client["constellation.defaults.get"]({}))
      .then(
        () => null,
        (error: Error) => error
      );

    expect(refused).toBeInstanceOf(NotConnected);
  } finally {
    await connection.close();
  }
}, 30_000);

test("the bridge refuses any request with an Origin, even with the token", async () => {
  const url = devBridgeUrl(bridge).replace("ws://", "http://");
  const response = await fetch(url, { headers: { Origin: "http://127.0.0.1:8080" } });

  expect(response.status).toBe(403);
});

test("after the Daemon restarts the connection comes back on a new epoch", async () => {
  const connection = open(bridge.token);

  try {
    const first = await until(connection, (s) => s.state === "connected");

    await daemon.restart();
    const again = await until(connection, (s) => s.state === "connected" && s.epoch > first.epoch);

    expect(connection.live()?.epoch).toBe(again.epoch);
  } finally {
    await connection.close();
  }
}, 60_000);
