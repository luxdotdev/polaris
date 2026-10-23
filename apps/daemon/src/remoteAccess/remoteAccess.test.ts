import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";
import { RemoteAccess, RemoteAccessLive } from "../extensions/remoteAccess.ts";
import { runTailscaleCommand } from "./cli.ts";
import { makeRemoteAccess, RemoteAccessControl } from "./index.ts";
import { findTailscale, MACOS_APP_CLI } from "./tailscale.ts";

const HOST = "mac.tail1234.ts.net";

const FAKE = join(import.meta.dir, "fixtures", "fake-tailscale.ts");

let dir: string;

/** The fake CLI's environment: its directory on PATH and its state directory. */
type FakeEnv = {
  readonly PATH: string;
  readonly FAKE_TAILSCALE_DIR: string;
};

let env: FakeEnv;

let gateway: ReturnType<typeof Bun.serve>;

/** A loopback server answering `/polaris/identity` with `nonce`, as the gateway does. */
const serveIdentity = (nonce: string) =>
  Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === "/polaris/identity"
        ? Response.json({ nonce })
        : new Response(null, { status: 404 }),
  });

/** Starts a gateway and records it in `gateway.json`, as the Daemon does on each start. */
const startGateway = (nonce = crypto.randomUUID()) => {
  void gateway?.stop(true);
  gateway = serveIdentity(nonce);
  writeFileSync(join(dir, "gateway.json"), JSON.stringify({ port: gateway.port, nonce }));

  return gateway.port;
};

const status = (overrides: { BackendState?: string; Self?: object } = {}) =>
  writeFileSync(
    join(dir, "status.json"),
    JSON.stringify({
      BackendState: "Running",
      Self: { DNSName: `${HOST}.`, CapMap: { https: null, funnel: null } },
      ...overrides,
    })
  );

const decodeCall = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ args: Schema.Array(Schema.String) }))
);

const decodeServe = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      Web: Schema.Record(
        Schema.String,
        Schema.Struct({
          Handlers: Schema.Record(Schema.String, Schema.Struct({ Proxy: Schema.String })),
        })
      ),
    })
  )
);

const calls = (): ReadonlyArray<ReadonlyArray<string>> =>
  readFileSync(join(dir, "calls.log"), "utf8")
    .trim()
    .split("\n")
    .map((line) => decodeCall(line).args);

const serveCalls = () => calls().filter((args) => args[0] === "serve" && args[1] !== "status");

const handlers = () =>
  decodeServe(readFileSync(join(dir, "serve.json"), "utf8")).Web[`${HOST}:443`]?.Handlers;

const remoteAccess = (os = "darwin") =>
  makeRemoteAccess({ root: dir, os, findCli: () => findTailscale(env, os, () => false) });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pol-ts-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "tailscale"), `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
  chmodSync(join(bin, "tailscale"), 0o755);
  writeFileSync(join(dir, "calls.log"), "");
  env = { PATH: bin, FAKE_TAILSCALE_DIR: dir };
  status();
  startGateway();
});

afterEach(() => {
  void gateway.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

describe("findTailscale", () => {
  test("uses the CLI on PATH, else the macOS app's binary as a CLI, else none", () => {
    expect(findTailscale(env, "darwin", () => true)?.path).toBe(join(dir, "bin", "tailscale"));

    const app = findTailscale({ PATH: "/nonexistent" }, "darwin", (path) => path === MACOS_APP_CLI);
    expect(app?.path).toBe(MACOS_APP_CLI);
    expect(app?.env.TAILSCALE_BE_CLI).toBe("1");

    expect(findTailscale({ PATH: "/nonexistent" }, "linux", () => true)).toBeNull();
    expect(findTailscale({ PATH: "/nonexistent" }, "darwin", () => false)).toBeNull();
  });
});

describe("Remote Access", () => {
  test("turning on serves the gateway's path with the prefix put back, then reports its URL", async () => {
    const port = startGateway();
    const access = remoteAccess();

    expect((await Effect.runPromise(access.status)).state).toBe("off");

    const on = await Effect.runPromise(access.enable);

    expect(serveCalls()).toEqual([
      [
        "serve",
        "--bg",
        "--https=443",
        "--set-path",
        "/polaris",
        `http://127.0.0.1:${port}/polaris`,
      ],
    ]);
    expect(on).toMatchObject({
      state: "on",
      url: `wss://${HOST}/polaris/rpc`,
      hostName: HOST,
      reason: null,
    });
  });

  test("turning off removes only Polaris's path, and off again is fine", async () => {
    writeFileSync(
      join(dir, "serve.json"),
      JSON.stringify({
        Web: { [`${HOST}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:3773" } } } },
      })
    );
    const access = remoteAccess();
    await Effect.runPromise(access.enable);

    const off = await Effect.runPromise(access.disable);

    expect(off).toMatchObject({ state: "off", url: null });
    expect(handlers()).toEqual({ "/": { Proxy: "http://127.0.0.1:3773" } });
    expect((await Effect.runPromise(access.disable)).state).toBe("off");
  });

  test("a path still proxying to an old gateway port reads as exposed, and on replaces it", async () => {
    const access = remoteAccess();

    await Effect.runPromise(access.enable);
    const port = startGateway();

    expect(await Effect.runPromise(access.status)).toMatchObject({
      state: "on",
      url: null,
      reason: "serving-elsewhere",
    });
    await Effect.runPromise(access.enable);
    expect(handlers()?.["/polaris"]).toEqual({ Proxy: `http://127.0.0.1:${port}/polaris` });
  });

  test("a gateway that stopped leaves its path exposed until turned off, never reading as off", async () => {
    const access = remoteAccess();

    await Effect.runPromise(access.enable);
    rmSync(join(dir, "gateway.json"));

    expect(await Effect.runPromise(access.status)).toMatchObject({
      state: "on",
      url: null,
      reason: "gateway-not-running",
    });
    expect(await Effect.runPromise(access.disable)).toMatchObject({
      state: "off",
      reason: "gateway-not-running",
    });
    expect(handlers()).toEqual({});
  });

  test.each([
    ["no gateway is recorded", () => rmSync(join(dir, "gateway.json"))],
    [
      "another process holds the gateway's port",
      () => {
        void gateway.stop(true);
        gateway = serveIdentity("not-the-recorded-nonce");
        writeFileSync(
          join(dir, "gateway.json"),
          JSON.stringify({ port: gateway.port, nonce: "ours" })
        );
      },
    ],
  ] as const)("when %s, it is off and is never served to the tailnet", async (_, arrange) => {
    arrange();
    const access = remoteAccess();

    expect(await Effect.runPromise(access.status)).toMatchObject({
      state: "off",
      url: null,
      reason: "gateway-not-running",
    });
    expect((await Effect.runPromise(Effect.flip(access.enable))).reason).toBe(
      "gateway-not-running"
    );
    expect(serveCalls()).toEqual([]);
  });

  test.each([
    ["logged out", { BackendState: "NeedsLogin" }, "not-logged-in"],
    ["stopped", { BackendState: "Stopped" }, "not-running"],
    [
      "without HTTPS certificates",
      { Self: { DNSName: `${HOST}.`, CapMap: { funnel: null } } },
      "https-disabled",
    ],
    ["without MagicDNS", { Self: { DNSName: "", CapMap: { https: null } } }, "https-disabled"],
  ] as const)(
    "Tailscale %s is unavailable and is never asked to serve",
    async (_, overrides, reason) => {
      status(overrides);
      const access = remoteAccess();

      expect(await Effect.runPromise(access.status)).toMatchObject({
        state: "unavailable",
        reason,
      });
      const error = await Effect.runPromise(Effect.flip(access.enable));
      expect(error.reason).toBe(reason);
      // `serve` without HTTPS waits on a prompt; it must not be started.
      expect(serveCalls()).toEqual([]);
    }
  );

  test("Tailscale's stderr is classified and never repeated, even when it holds an auth key", async () => {
    writeFileSync(
      join(dir, "status.fail"),
      "failed to connect to local Tailscale daemon tskey-auth-k123SECRET\n"
    );
    const access = remoteAccess();

    const answer = await Effect.runPromise(access.status);
    const error = await Effect.runPromise(Effect.flip(access.enable));

    expect(answer).toMatchObject({ state: "unavailable", reason: "not-running" });
    expect(JSON.stringify([answer, error, error.message])).not.toContain("tskey");
  });

  test("a refused serve is needs-operator on Linux, where the user must be the operator", async () => {
    writeFileSync(
      join(dir, "serve.fail"),
      "Access denied: serve config denied\nUse 'sudo tailscale set --operator=$USER'\n"
    );

    expect((await Effect.runPromise(Effect.flip(remoteAccess("linux").enable))).reason).toBe(
      "needs-operator"
    );
    expect((await Effect.runPromise(Effect.flip(remoteAccess("darwin").enable))).reason).toBe(
      "failed"
    );
  });

  test("without Tailscale it is unavailable, and off has nothing to remove", async () => {
    const access = makeRemoteAccess({ root: dir, findCli: () => null });

    expect(await Effect.runPromise(access.status)).toMatchObject({ reason: "not-installed" });
    expect(await Effect.runPromise(access.disable)).toMatchObject({ reason: "not-installed" });
  });

  test("the pairing string's URL follows Remote Access", async () => {
    const control = remoteAccess();

    const url = Effect.flatMap(RemoteAccess, (access) => access.url).pipe(
      Effect.provide(RemoteAccessLive),
      Effect.provideService(RemoteAccessControl, control)
    );

    expect(await Effect.runPromise(url)).toEqual(Option.none());
    await Effect.runPromise(control.enable);
    expect(await Effect.runPromise(url)).toEqual(Option.some(`wss://${HOST}/polaris/rpc`));
  });
});

describe("polaris tailscale", () => {
  const run = async (args: ReadonlyArray<string>) => {
    const lines: Array<string> = [];

    const code = await runTailscaleCommand(
      args,
      { root: dir, os: "darwin", findCli: () => findTailscale(env, "darwin", () => false) },
      (line) => lines.push(line),
      (line) => lines.push(line)
    );

    return { code, output: lines.join("\n") };
  };

  test("on, status and off say where Extensions connect, and fail with a reason", async () => {
    expect(await run(["on"])).toEqual({
      code: 0,
      output: `Remote access is on: https://${HOST}/polaris\nExtensions connect to wss://${HOST}/polaris/rpc`,
    });
    expect((await run(["status"])).code).toBe(0);
    expect((await run(["off"])).output).toBe(
      "Remote access is off. Turn it on with `polaris tailscale on`."
    );

    status({ BackendState: "NeedsLogin" });
    expect(await run(["on"])).toEqual({
      code: 1,
      output: "polaris tailscale: Tailscale isn't logged in on this host.",
    });
    expect((await run(["status"])).code).toBe(1);
    expect((await run([])).code).toBe(2);
  });
});
