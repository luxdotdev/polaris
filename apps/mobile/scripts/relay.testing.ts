/**
 * For tests: the real Polaris Relay (`bun apps/relay/src/main.ts`) on a fixed port, so it
 * can stop and start again at the same URL, and a real Daemon whose secrets stay off the
 * Keychain with the Relay route on.
 */
import { connectRpc, type DaemonClient } from "@polaris/client/rpc";
import { socketTransport } from "@polaris/sdk";
import { launchDaemon, type TestDaemon } from "@polaris/sdk/testing";
import { Effect, Exit, Scope } from "effect";

const RELAY_DIR = new URL("../../relay/", import.meta.url).pathname;

const TEST_DAEMON_MAIN = new URL("../../daemon/src/main.testing.ts", import.meta.url).pathname;

const freePort = (): number => {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const port = probe.port ?? 0;

  void probe.stop(true);

  return port;
};

export interface TestRelay {
  readonly url: string;
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
}

export const relayProcess = (port = freePort()): TestRelay => {
  let child: Bun.Subprocess<"ignore", "pipe", "inherit"> | null = null;

  const start = async () => {
    const spawned = Bun.spawn(["bun", "src/main.ts"], {
      cwd: RELAY_DIR,
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

    child = spawned;
    const reader = spawned.stdout.getReader();
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
  };

  return {
    url: `ws://127.0.0.1:${port}/v1`,
    start,
    stop: async () => {
      child?.kill("SIGTERM");
      await child?.exited;
      child = null;
    },
  };
};

/** Waits until the Daemon's relay socket proved its key. */
export const connectedTo = async (client: DaemonClient, ms = 20_000) => {
  const deadline = Date.now() + ms;

  while (!(await Effect.runPromise(client["relayRoute.status"]())).connected) {
    if (Date.now() > deadline) throw new Error("the Daemon never connected to the relay");
    await Bun.sleep(50);
  }
};

export interface RelayDaemon {
  readonly daemon: TestDaemon;
  /** The Desktop App's view: a token-less Client on the Daemon's socket. */
  readonly client: DaemonClient;
  readonly stop: () => Promise<void>;
}

/** A Daemon with the Relay route on `relayUrl`; HostSecrets in its home, not the Keychain. */
export const launchRelayDaemon = async (relayUrl: string): Promise<RelayDaemon> => {
  const daemon = await launchDaemon({ main: TEST_DAEMON_MAIN });
  const scope = Effect.runSync(Scope.make());

  const client = await Effect.runPromise(
    Scope.provide(
      Effect.gen(function* () {
        const connection = yield* connectRpc(
          yield* socketTransport(daemon.socketPath, daemon.hostId)
        );

        yield* connection.client.hello({
          clientName: "relay-tests",
          clientVersion: "0.0.0",
          deviceLabel: "Relay tests",
          capabilities: [],
        });

        return connection.client;
      }),
      scope
    )
  );

  await Effect.runPromise(client["relayRoute.enable"]({ url: relayUrl }));
  await connectedTo(client);

  return {
    daemon,
    client,
    stop: async () => {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      await daemon.stop();
    },
  };
};
