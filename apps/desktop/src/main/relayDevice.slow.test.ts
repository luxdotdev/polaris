/**
 * The Desktop App through a real relay (ENG-943): a Host admits this app's relay device by
 * its public keys (`devices.add`, as an accepted Invite will), and the HostDirectory reaches
 * the real Daemon over a Relay target, with the same session feed as over SSH.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  connectRpc,
  type DaemonClient,
  HostConnector,
  HostRegistry,
  HostTarget,
  socketTransport,
} from "@polaris/client";
import {
  Command,
  CommandId,
  type RelayRouteStatus,
  SessionId,
  SessionPlacement,
  type SessionStreamItem,
  WorkspaceId,
} from "@polaris/protocol";
import { relayBinary } from "@polaris/relay/testing/binary";
import { launchDaemon, TEST_USER_KEY, type TestDaemon } from "@polaris/sdk/testing";
import { Context, Effect, Exit, Layer, Predicate, Redacted, Scope, Stream } from "effect";
import { HostDirectory } from "./hosts.ts";
import { desktopRelayDevice } from "./relayDevice.ts";
import { SecureStorage } from "./secure/index.ts";

// Built here, as the file loads, so no test's timeout pays for a cold build.
const RELAY = relayBinary();

const TEST_DAEMON_MAIN = new URL("../../../daemon/src/main.testing.ts", import.meta.url).pathname;

const freePort = (): number => {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const port = probe.port ?? 0;

  void probe.stop(true);

  return port;
};

let relay: Bun.Subprocess<"ignore", "pipe", "inherit">;

let relayUrl: string;

let daemon: TestDaemon;

let admin: DaemonClient;

const adminScope = Effect.runSync(Scope.make());

const startRelay = async () => {
  const port = freePort();

  relay = Bun.spawn([RELAY], {
    env: {
      ...process.env,
      PORT: String(port),
      POLARIS_RELAY_HOSTNAME: "127.0.0.1",
      POLARIS_RELAY_CONNECT_BURST_PER_IP: "200",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
  });

  const reader = relay.stdout.getReader();
  let text = "";
  const deadline = Date.now() + 10_000;

  while (!text.includes('"relay.start"')) {
    if (Date.now() > deadline) throw new Error("the relay did not start");
    const { value, done } = await reader.read();

    if (done) throw new Error("the relay exited");
    text += new TextDecoder().decode(value);
  }

  // Keep draining its log so the pipe never fills.
  void (async () => {
    for (;;) if ((await reader.read()).done) break;
  })();

  relayUrl = `ws://127.0.0.1:${port}/v1`;
};

/** The route's status once the Daemon's relay socket proved its key. */
const routeConnected = async (): Promise<RelayRouteStatus> => {
  const deadline = Date.now() + 20_000;

  for (;;) {
    const status = await Effect.runPromise(admin["relayRoute.status"]());

    if (status.connected) return status;

    if (Date.now() > deadline) throw new Error("the Daemon never connected to the relay");
    await Bun.sleep(50);
  }
};

beforeAll(async () => {
  await startRelay();
  daemon = await launchDaemon({ main: TEST_DAEMON_MAIN });

  admin = await Effect.runPromise(
    Scope.provide(
      Effect.gen(function* () {
        const connection = yield* connectRpc(yield* socketTransport(daemon.socketPath));

        yield* connection.client.hello({
          clientName: "relay-device-tests",
          clientVersion: "0.0.0",
          deviceLabel: "Relay device tests",
          capabilities: [],
          userKey: Redacted.make(TEST_USER_KEY),
        });

        return connection.client;
      }),
      adminScope
    )
  );

  await Effect.runPromise(admin["relayRoute.enable"]({ url: relayUrl }));
}, 120_000);

afterAll(async () => {
  await Effect.runPromise(Scope.close(adminScope, Exit.void));
  await daemon?.stop();
  relay?.kill("SIGTERM");
  await relay?.exited;
});

const startSession = (client: DaemonClient, workspaceId: string) => {
  const sessionId = SessionId.make(`relay-${crypto.randomUUID()}`);

  return Effect.as(
    client.dispatch({
      commandId: CommandId.make(crypto.randomUUID()),
      command: Command.cases.StartSession.make({
        sessionId,
        workspaceId: WorkspaceId.make(workspaceId),
        harness: "claude",
        placement: SessionPlacement.cases.InPlace.make({}),
        permissionMode: "plan",
        model: null,
        effort: null,
        prompt: `bench:${JSON.stringify({ items: 2 })}`,
        attachments: [],
      }),
    }),
    sessionId
  );
};

const turnEnded = (item: SessionStreamItem) =>
  Predicate.isTagged(item, "Event") && Predicate.isTagged(item.envelope.event, "TurnEnded");

test("the Desktop App reaches a Host through the relay and follows a session's feed", async () => {
  const status = await routeConnected();

  const storage = Effect.runSync(
    Effect.provide(
      SecureStorage.useSync((s) => s),
      SecureStorage.memory
    )
  );

  const device = desktopRelayDevice(storage, { backoff: () => 100 });
  const keys = await Effect.runPromise(device.publicKeys);

  // What accepting an Invite will send: only the device's public keys.
  await Effect.runPromise(
    admin["devices.add"]({
      name: "Test Mac",
      relayAddress: keys.relayAddress,
      noiseKey: keys.noiseKey,
    })
  );

  const workspaceId = await daemon.registerWorkspace();
  const scope = Effect.runSync(Scope.make());

  try {
    const directory = await Effect.runPromise(
      Effect.map(
        Layer.build(
          HostDirectory.layer({
            entries: [
              {
                key: "relay-host",
                label: "Relay host",
                colour: null,
                alias: null,
                proofHarness: false,
                target: HostTarget.Relay({
                  relayUrl,
                  hostAddress: status.hostAddress,
                  hostNoiseKey: status.hostNoiseKey,
                }),
                remoteCommand: null,
                simulatedLatencyMs: null,
              },
            ],
            identity: {
              name: "Polaris",
              version: "0.0.0",
              deviceLabel: "Test Mac",
              capabilities: [],
            },
            relay: device.connector,
          }).pipe(Layer.provideMerge(HostRegistry.layer), Layer.provide(HostConnector.layer))
        ),
        Context.get(HostDirectory)
      ).pipe(Scope.provide(scope))
    );

    const connection = await Effect.runPromise(directory.connection("relay-host"));

    const live = await Effect.runPromise(
      connection.awaitSession.pipe(Effect.timeout("30 seconds"))
    );

    expect(live.host.hostId).toBe(daemon.hostId);
    expect(directory.entry("relay-host")?.target._tag).toBe("Relay");

    const sessionId = await Effect.runPromise(startSession(live.client, workspaceId));

    const items = await Effect.runPromise(
      connection
        .subscribeSession(sessionId)
        .pipe(Stream.takeUntil(turnEnded), Stream.runCollect, Effect.timeout("30 seconds"))
    );

    const [first] = items;

    expect(first?._tag).toBe("Snapshot");
    expect(items.some(turnEnded)).toBe(true);
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    device.close();
  }
}, 90_000);
