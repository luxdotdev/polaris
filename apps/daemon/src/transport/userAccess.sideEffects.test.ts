/**
 * What a socket-only process could still reach through requests marked `any`, over a real
 * socket (ENG-927, ADR 0114): file contents, the Host's loopback, stored credentials, a provider
 * key, the user's presence, another caller's lease, and handlers that start or persist something.
 */
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BlobId, CommandId, EditPredictionRequest, PredictionRequest } from "@polaris/protocol";
import { Effect, Layer, type Scope, Stream } from "effect";
import { makeBenchDriver } from "../harness/bench/BenchDriver.ts";
import type { HarnessDriver } from "../harness/HarnessDriver.ts";
import { HarnessRpcsLive } from "../harness/HarnessRpcs.ts";
import { scopedTempDir } from "../platform/tempDir.testing.ts";
import { predictionRequestHandlers } from "../prediction/index.ts";
import { ManagedServer } from "../prediction/managed/server.ts";
import { ManagedModelServer } from "../prediction/managed/service.ts";
import { HostResources } from "../resources/index.ts";
import { processIdentity } from "../resources/process.ts";
import { ResourceRpcsLive } from "../resources/rpc.ts";
import { HarnessRegistry, ServiceError } from "../services.ts";
import { EventStore } from "../store/EventStore.ts";
import { TracesRpcsLive } from "../traces/rpcs.ts";
import { TraceRuntime } from "../traces/runtime.ts";
import { developerModeOff } from "../traces/self/developerMode.ts";
import { TraceSessions } from "../traces/sessions.ts";
import { TraceStore } from "../traces/store.ts";
import { TEST_SESSION, withTraceFixture } from "../traces/testing.ts";
import { ServerRpcs } from "./rpcs.ts";
import { startServer } from "./server.ts";
import {
  type Connect,
  connectAt,
  DESKTOP_KEY,
  hello,
  outcome,
  sessionId,
} from "./userAccessServer.testing.ts";

const temporary = scopedTempDir("pl-ua-", { short: true });

type Client = Effect.Success<ReturnType<Connect>>["client"];

/** The first Desktop App, enrolled by its `hello`, and a process that only reached the socket. */
const withCallers = <A, E, HE, HR>(
  handlers: Layer.Layer<never, HE, HR>,
  body: (callers: { app: Client; agent: Client; root: string }) => Effect.Effect<A, E, Scope.Scope>
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* temporary;

      const server = yield* startServer({
        root,
        socketPath: join(root, "d.sock"),
        lockPath: join(root, "d.lock"),
        // SAFETY: each test's layer provides only RPC handlers, which is what the server takes.
        handlers: handlers as Layer.Layer<never, never, never>,
      });

      const app = (yield* connectAt(server.socketPath)).client;
      yield* app.hello(hello(DESKTOP_KEY, "Mac Studio"));
      const agent = (yield* connectAt(server.socketPath)).client;
      yield* agent.hello(hello(undefined, "agent"));

      return yield* body({ app, agent, root });
    })
  );

test("a socket-only process can't read files, reach the Host's loopback, use stored credentials or the provider key, or report presence", async () => {
  const reached: Array<string> = [];

  /** Records that the request got past the gate, then fails as a defect. */
  const reach = (tag: string) =>
    Effect.suspend(() => {
      reached.push(tag);

      return Effect.die(tag);
    });

  const handlers = Layer.mergeAll(
    ServerRpcs.toLayerHandler("hostAddress.open", () => Stream.fromEffect(reach("open"))),
    ServerRpcs.toLayerHandler("files.read", () => reach("read")),
    ServerRpcs.toLayerHandler("files.readVersioned", () => reach("readVersioned")),
    ServerRpcs.toLayerHandler("files.grep", () => reach("grep")),
    ServerRpcs.toLayerHandler("data.describe", () => reach("describe")),
    ServerRpcs.toLayerHandler("voice.transcribe", () => Stream.fromEffect(reach("transcribe"))),
    ServerRpcs.toLayerHandler("presence.report", () => reach("presence"))
  );

  const requests = (client: Client, root: string) => {
    const path = join(root, "user-access.json");
    const blob = BlobId.make("b1");

    return Effect.all({
      open: outcome(
        Stream.runDrain(
          client["hostAddress.open"]({
            hostname: "localhost",
            port: 5432,
            upstream: blob,
            window: 65_536,
          })
        )
      ),
      read: outcome(client["files.read"]({ path, offset: null, length: null })),
      readVersioned: outcome(client["files.readVersioned"]({ path })),
      grep: outcome(
        client["files.grep"]({
          root,
          pattern: "key",
          regex: false,
          caseSensitive: false,
          limit: 10,
        })
      ),
      describe: outcome(client["data.describe"]({ sessionId, source: "production" })),
      transcribe: outcome(Stream.runDrain(client["voice.transcribe"]({ audio: blob }))),
      presence: outcome(client["presence.report"]({ presence: "present" })),
    });
  };

  const result = await Effect.runPromise(
    withCallers(handlers, ({ app, agent, root }) =>
      Effect.gen(function* () {
        const refused = yield* requests(agent, root);
        const before = [...reached];
        const admitted = yield* requests(app, root);

        return { refused, before, admitted, after: reached.toSorted() };
      })
    )
  );

  expect(result.refused).toEqual({
    open: "UserAccessRequired:hostAddress.open",
    read: "UserAccessRequired:files.read",
    readVersioned: "UserAccessRequired:files.readVersioned",
    grep: "UserAccessRequired:files.grep",
    describe: "UserAccessRequired:data.describe",
    transcribe: "UserAccessRequired:voice.transcribe",
    presence: "UserAccessRequired:presence.report",
  });
  expect(result.before).toEqual([]);
  // The enrolled Desktop App reaches every handler.
  expect(new Set(Object.values(result.admitted))).toEqual(new Set(["defect"]));
  expect(result.after).toEqual(
    ["describe", "grep", "open", "presence", "read", "readVersioned", "transcribe"].toSorted()
  );
});

test("traces.watch issues the ingestion endpoint to the user only, and persists no token for anyone else", () =>
  withTraceFixture(async (f) => {
    const handlers = TracesRpcsLive.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(TraceRuntime, f.runtime),
          Layer.succeed(TraceStore, f.store),
          Layer.succeed(TraceSessions, f.sessions),
          developerModeOff
        )
      )
    );

    const tokens = join(f.root, "tokens.json");
    const saved = () => (existsSync(tokens) ? readFileSync(tokens, "utf8") : null);

    const pages = (client: Client) =>
      client["traces.watch"]({ sessionId: TEST_SESSION, filter: {} }).pipe(
        Stream.tap(() => f.store.notify),
        Stream.take(2),
        Stream.runCollect,
        Effect.timeout("3 seconds")
      );

    const result = await Effect.runPromise(
      withCallers(handlers, ({ app, agent }) =>
        Effect.gen(function* () {
          const before = saved();
          const agentPages = yield* pages(agent);
          const untouched = saved() === before;

          return { agentPages, untouched, appPages: yield* pages(app) };
        })
      )
    );

    expect(result.agentPages.map((page) => page.endpoint)).toEqual([null, null]);
    expect(result.untouched).toBe(true);
    // The user's watch carries it on the first page only.
    expect(result.appPages.map((page) => page.endpoint)).toEqual([f.endpoint, null]);
    expect(f.endpoint).not.toBeNull();
  }));

/** A stopped managed server that owns every endpoint and counts what would start or wake it. */
class StoppedServer extends ManagedServer {
  starts = 0;
  touches = 0;

  override ownsUrl() {
    return true;
  }

  override isServing() {
    return false;
  }

  override start() {
    this.starts += 1;

    return Promise.reject(new Error("no model in this test"));
  }

  override touch() {
    this.touches += 1;
  }
}

const endpoint = { kind: "openai" as const, url: "http://127.0.0.1:9/v1" };

const completion = PredictionRequest.make({
  context: [],
  path: "a.ts",
  prefix: "const a = ",
  suffix: ";\n",
  model: "fixture",
  format: "mellum-spm",
  endpoint,
  budgetTokens: 512,
  maxTokens: 32,
  maxLines: 3,
});

test("a prediction from a socket-only process never starts the stopped managed server", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const root = yield* temporary;
      const server = new StoppedServer({ defaultDir: root });

      const handlers = predictionRequestHandlers.pipe(
        Layer.provide(Layer.succeed(ManagedModelServer, server))
      );

      const edit = EditPredictionRequest.make({
        context: [],
        path: "a.ts",
        buffer: "const a = 1;\n",
        cursor: 0,
        focus: null,
        history: [],
        model: "fixture",
        format: "zeta-2.1",
        endpoint,
        maxTokens: 32,
      });

      return yield* withCallers(handlers, ({ app, agent }) =>
        Effect.gen(function* () {
          const refused = {
            complete: yield* outcome(Stream.runDrain(agent["prediction.complete"](completion))),
            edit: yield* outcome(Stream.runDrain(agent["prediction.edit"](edit))),
          };

          const untouched = { starts: server.starts, touches: server.touches };
          yield* outcome(Stream.runDrain(app["prediction.complete"](completion)));

          return { refused, untouched, startsForTheUser: server.starts };
        })
      );
    }).pipe(Effect.scoped)
  );

  expect(result).toEqual({
    refused: { complete: "PredictionError", edit: "PredictionError" },
    untouched: { starts: 0, touches: 0 },
    startsForTheUser: 1,
  });
});

test("harness.models and harness.commands serve a socket-only process the cache and never ask the Harness for it", async () => {
  const asked = { models: 0, commands: 0 };
  const bench = makeBenchDriver("codex");

  const driver: HarnessDriver = {
    ...bench,
    listModels: Effect.suspend(() => {
      asked.models += 1;

      return bench.listModels ?? Effect.succeed([]);
    }),
    listCommands: (cwd) =>
      Effect.suspend(() => {
        asked.commands += 1;

        return bench.listCommands?.(cwd) ?? Effect.succeed([]);
      }),
  };

  const registry = Layer.succeed(
    HarnessRegistry,
    HarnessRegistry.of({
      get: (kind) =>
        kind === "codex"
          ? Effect.succeed(driver)
          : Effect.fail(new ServiceError({ service: "harness", message: `no ${kind} driver` })),
      all: Effect.succeed([driver]),
    })
  );

  const models = (client: Client, refresh: boolean) =>
    outcome(client["harness.models"]({ harness: "codex", refresh }));

  const commands = (client: Client, refresh: boolean) =>
    outcome(client["harness.commands"]({ harness: "codex", cwd: "/repo", refresh }));

  const result = await Effect.runPromise(
    withCallers(HarnessRpcsLive.pipe(Layer.provide(registry)), ({ app, agent }) =>
      Effect.gen(function* () {
        const cold = { models: yield* models(agent, true), commands: yield* commands(agent, true) };
        const askedCold = { ...asked };
        const user = { models: yield* models(app, false), commands: yield* commands(app, false) };
        // Cached now: served, and `refresh` from this caller asks nobody.
        const warm = { models: yield* models(agent, true), commands: yield* commands(agent, true) };

        return { cold, askedCold, user, warm, asked: { ...asked } };
      })
    )
  );

  expect(result).toEqual({
    cold: { models: "HarnessUnavailable", commands: "HarnessUnavailable" },
    askedCold: { models: 0, commands: 0 },
    user: { models: "ok", commands: "ok" },
    warm: { models: "ok", commands: "ok" },
    asked: { models: 1, commands: 1 },
  });
});

test("a socket-only process releases the lease it asked for and nobody else's", async () => {
  const previous = process.env.POLARIS_HOME;

  try {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const home = yield* temporary;
        process.env.POLARIS_HOME = home;
        const identity = yield* Effect.promise(() => processIdentity(process.pid));

        if (identity === null) return yield* Effect.die("this process has no identity");

        const handlers = ResourceRpcsLive.pipe(
          Layer.provide(HostResources.layer),
          Layer.provide(EventStore.layerSqlite(join(home, "state.sqlite")))
        );

        const lease = (name: string) => ({
          requestId: crypto.randomUUID(),
          name,
          processId: process.pid,
          processIdentity: identity,
          command: ["bun", "test"],
          sessionId: null,
        });

        return yield* withCallers(handlers, ({ app, agent, root }) =>
          Effect.gen(function* () {
            const other = (yield* connectAt(join(root, "d.sock"))).client;
            yield* other.hello(hello(undefined, "another agent"));

            const release = (client: Client, leaseId: string) =>
              outcome(
                client["host.resources.release"]({
                  commandId: CommandId.make(crypto.randomUUID()),
                  leaseId,
                })
              );

            const held = Effect.map(app["host.resources.get"]({}), (snapshot) =>
              snapshot.resourceLeases.map((entry) => entry.resource).toSorted()
            );

            const bench = yield* agent["host.resources.acquire"](lease("bench"));
            const smoke = yield* other["host.resources.acquire"](lease("smoke"));
            // Asking again for a lease that exists does not make it this connection's.
            yield* other["host.resources.acquire"]({ ...lease("bench"), requestId: bench.id });

            return {
              others: yield* release(other, bench.id),
              afterRefusal: yield* held,
              own: yield* release(agent, bench.id),
              user: yield* release(app, smoke.id),
              afterRelease: yield* held,
            };
          })
        );
      }).pipe(Effect.scoped)
    );

    expect(result).toEqual({
      others: "ResourceError",
      afterRefusal: ["bench", "smoke"],
      own: "ok",
      user: "ok",
      afterRelease: [],
    });
  } finally {
    if (previous === undefined) delete process.env.POLARIS_HOME;
    else process.env.POLARIS_HOME = previous;
  }
});
