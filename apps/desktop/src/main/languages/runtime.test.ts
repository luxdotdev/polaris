import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  HostConnector,
  HostRegistry,
  HostTarget,
  LanguageAccess,
  makeHostConnection,
  type HostConnection,
} from "@polaris/client";
import * as P from "@polaris/protocol";
import {
  Context,
  Deferred,
  Effect,
  Layer,
  ManagedRuntime,
  Option,
  Redacted,
  Stream,
  SubscriptionRef,
} from "effect";
import { startServer } from "../../../../daemon/src/transport/server.ts";
import { ServerRpcs } from "../../../../daemon/src/transport/rpcs.ts";
import { HostDirectory, UnknownHost, type ClientRuntime, type HostEntry } from "../hosts.ts";
import { LanguageIdentityEpochs } from "./identityEpochs.ts";
import { createMainLanguageApi } from "./runtime.ts";
import { LanguagePreferences } from "./settings.ts";
import type { HostView } from "../../shared/api.ts";

const proof = Redacted.make("d".repeat(64));

const identity = {
  name: "fake",
  version: "0",
  deviceLabel: "fixture",
  capabilities: ["blobs", "languages"] as const,
};

const snapshot = P.HostStreamItem.cases.Snapshot.make({
  sequence: P.Sequence.make(0),
  workspaces: [],
  worktrees: [],
  sessions: [],
  reviewCheckouts: [],
});

const temporary = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync("/tmp/pl-a0-main-runtime-")),
  (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true }))
);

const fixture = (stall = false) =>
  Effect.gen(function* () {
    const root = yield* temporary;
    const entered = yield* Deferred.make<void>();
    const ended = yield* Deferred.make<void>();
    let starts = 0;
    let active = 0;

    const handlers = ServerRpcs.toLayerHandler("subscribeHost", () =>
      Stream.suspend(() => {
        starts++;
        active++;

        const output = stall
          ? Effect.andThen(Deferred.succeed(entered, undefined), Effect.never)
          : Effect.succeed(snapshot);

        return Stream.fromEffect(output).pipe(
          Stream.ensuring(
            Effect.andThen(
              Effect.sync(() => {
                active--;
              }),
              Deferred.succeed(ended, undefined)
            )
          )
        );
      })
    );

    const server = yield* startServer({
      root,
      socketPath: join(root, "d.sock"),
      lockPath: join(root, "d.lock"),
      handlers,
      capabilities: ["languages"],
    });

    const options = {
      key: "fixture",
      name: "fixture",
      target: HostTarget.Local({ socketPath: server.socketPath }),
      identity,
    };

    const authenticated = () =>
      makeHostConnection({
        ...options,
        clientIdentity: { proof, expectedHostId: server.hostInfo.hostId },
      });

    const guest = () => makeHostConnection(options);

    return { options, authenticated, guest, entered, ended, facts: () => ({ starts, active }) };
  });

const mainFor = (initial: HostConnection) =>
  Effect.gen(function* () {
    let current: HostConnection | null = initial;
    const views = yield* SubscriptionRef.make<ReadonlyArray<HostView>>([]);

    const directory = HostDirectory.of({
      views,
      entry: () => undefined,
      connection: (key) =>
        current !== null && key === current.key
          ? Effect.succeed(current)
          : Effect.fail(new UnknownHost(key)),
      add: () => Effect.void,
      remove: () => Effect.void,
    });

    const runtime = ManagedRuntime.make(Layer.succeed(HostDirectory)(directory));

    yield* Effect.addFinalizer(() => Effect.promise(() => runtime.dispose()));
    yield* Effect.promise(() => runtime.runPromise(HostDirectory));
    const identities = new LanguageIdentityEpochs(() => current);
    // SAFETY: This reviewed Main factory consumes only HostDirectory; the fixture provides that actual service and real authenticated socket sessions.
    const clientRuntime = runtime as ClientRuntime;

    const main = createMainLanguageApi({
      runtime: clientRuntime,
      identities,
      preferences: new LanguagePreferences(
        () => ({ theme: "dark" }),
        () => {}
      ),
    });

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        main.dispose();
        identities.dispose();
      })
    );

    return {
      main,
      replace: (next: HostConnection | null) => {
        identities.invalidate("fixture");
        current = next;
      },
    };
  });

test("Main rejects missing private authority before starting any registry subscription", async () => {
  const facts = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const socket = yield* fixture();
        const guest = yield* socket.guest();

        yield* guest.awaitSession;
        const { main } = yield* mainFor(guest);

        const reply = yield* Effect.promise(() =>
          main.api.request("languages.identity.get", { hostKey: "fixture" })
        );

        return { ok: reply.ok, ...socket.facts() };
      })
    )
  );

  expect(facts.ok).toBe(false);
  expect(facts.starts).toBe(0);
  expect(facts.active).toBe(0);
});

test("disposing Main aborts a stalled real registry stream and settles the pending request", async () => {
  const facts = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const socket = yield* fixture(true);
        const connection = yield* socket.authenticated();

        yield* connection.awaitSession;
        const { main } = yield* mainFor(connection);
        const pending = main.api.request("languages.identity.get", { hostKey: "fixture" });

        yield* Deferred.await(socket.entered);
        main.dispose();
        const reply = yield* Effect.promise(() => pending);

        yield* Deferred.await(socket.ended);

        return { ok: reply.ok, ...socket.facts() };
      })
    )
  );

  expect(facts.ok).toBe(false);
  expect(facts.starts).toBe(1);
  expect(facts.active).toBe(0);
});

const disposalFacts = async (replaceWithGuest: boolean) => {
  const disposed = new Set<LanguageAccess>();
  // oxlint-disable-next-line typescript/unbound-method -- Scoped spy captures the implementation and invokes it with explicit this via call.
  const original = LanguageAccess.prototype.dispose;

  const spy = spyOn(LanguageAccess.prototype, "dispose").mockImplementation(function (
    this: LanguageAccess
  ) {
    disposed.add(this);
    original.call(this);
  });

  try {
    return await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const socket = yield* fixture();
          const first = yield* socket.authenticated();
          const second = yield* replaceWithGuest ? socket.guest() : socket.authenticated();

          yield* first.awaitSession;
          yield* second.awaitSession;
          const { main, replace } = yield* mainFor(first);

          const before = yield* Effect.promise(() =>
            main.api.request("languages.identity.get", { hostKey: "fixture" })
          );

          replace(second);

          const after = yield* Effect.promise(() =>
            main.api.request("languages.identity.get", { hostKey: "fixture" })
          );

          const afterReplacement = disposed.size;

          main.dispose();

          return {
            before: before.ok,
            after: after.ok,
            afterReplacement,
            afterDispose: disposed.size,
            starts: socket.facts().starts,
          };
        })
      )
    );
  } finally {
    spy.mockRestore();
  }
};

test("Main disposes replaced access even while both authenticated sockets remain alive", async () => {
  const facts = await disposalFacts(false);

  expect(facts.before).toBe(true);
  expect(facts.after).toBe(true);
  expect(facts.afterReplacement).toBe(1);
  expect(facts.afterDispose).toBe(2);
  expect(facts.starts).toBe(2);
});

test("failed preparation on a guest replacement disposes stale access without a guest registry subscription", async () => {
  const facts = await disposalFacts(true);

  expect(facts.before).toBe(true);
  expect(facts.after).toBe(false);
  expect(facts.afterReplacement).toBe(1);
  expect(facts.afterDispose).toBe(1);
  expect(facts.starts).toBe(1);
});

test("HostDirectory projects authenticated lifetime without later latency/status notifications", async () => {
  const facts = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const socket = yield* fixture();
        let registry: HostRegistry["Service"] | null = null;

        const identities = new LanguageIdentityEpochs((key) =>
          registry === null ? null : Option.getOrNull(Effect.runSync(registry.get(key)))
        );

        const connector = HostConnector.of({
          connect: (options) =>
            Effect.gen(function* () {
              const actual = yield* makeHostConnection(options);
              const status = yield* SubscriptionRef.make(yield* SubscriptionRef.get(actual.status));

              // Only real machine statuses are mirrored; later latency notifications cannot trigger projection.
              yield* actual.changes.pipe(
                Stream.filter((value) => value.latencyMs === null),
                Stream.runForEach((value) => SubscriptionRef.set(status, value)),
                Effect.forkScoped
              );

              return { ...actual, status, changes: SubscriptionRef.changes(status) };
            }),
        });

        const services = yield* Layer.build(
          HostDirectory.layer({
            entries: [],
            identity,
            clientIdentity: { proof },
            languageEpoch: (key, session) => identities.bind(key, session)?.connectionEpoch ?? null,
            invalidateLanguage: (key) => identities.invalidate(key),
          }).pipe(
            Layer.provideMerge(
              HostRegistry.layer.pipe(Layer.provide(Layer.succeed(HostConnector)(connector)))
            )
          )
        );

        registry = Context.get(services, HostRegistry);
        const directory = Context.get(services, HostDirectory);
        const rootTarget = socket.options.target;

        const entry: HostEntry = {
          key: "fixture",
          label: "fixture",
          colour: null,
          alias: null,
          proofHarness: false,
          target: rootTarget,
          remoteCommand: null,
          simulatedLatencyMs: null,
        };

        try {
          yield* directory.add(entry);

          const view = yield* SubscriptionRef.changes(directory.views).pipe(
            Stream.filter((values) =>
              values.some((value) => value.status.languageConnectionEpoch !== undefined)
            ),
            Stream.runHead
          );

          return Option.getOrNull(view)?.find((value) => value.key === "fixture") ?? null;
        } finally {
          identities.dispose();
        }
      })
    )
  );

  expect(facts).not.toBeNull();
  expect(facts?.status.state).toBe("connected");
  expect(facts?.status.languageConnectionEpoch).toBeGreaterThan(0);
  expect(facts?.status.latencyMs).toBeNull();
});
