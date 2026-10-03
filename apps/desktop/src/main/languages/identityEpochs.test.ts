import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  HostTarget,
  makeHostConnection,
  socketTransport,
  type HostConnection,
  LanguageAccess,
  languageTransportFor,
} from "@polaris/client";
import { Effect, Redacted, Stream } from "effect";
import { startServer } from "../../../../daemon/src/transport/server.ts";
import { LanguageIdentityEpochs } from "./identityEpochs.ts";
import { clientIdentityOf } from "./identity.ts";

const proof = Redacted.make("c".repeat(64));

const identity = {
  name: "fake",
  version: "0",
  deviceLabel: "fixture",
  capabilities: ["blobs", "languages", "languages.preview-media"] as const,
};

const temporary = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync("/tmp/pl-a0-epochs-")),
  (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true }))
);

const fixture = (
  capabilities: readonly ("languages" | "languages.preview-media")[] = ["languages"]
) =>
  Effect.gen(function* () {
    const root = yield* temporary;

    const server = yield* startServer({
      root,
      socketPath: join(root, "d.sock"),
      lockPath: join(root, "d.lock"),
      capabilities,
    });

    const options = {
      key: "fixture",
      name: "fixture",
      target: HostTarget.Local({ socketPath: server.socketPath }),
      identity,
      clientIdentity: { proof, expectedHostId: server.hostInfo.hostId },
    };

    return { server, options };
  });

test("Main epochs globally increase across actual HostConnection objects whose local epochs reset", async () => {
  const facts = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { options } = yield* fixture();
        const first = yield* makeHostConnection(options);
        const second = yield* makeHostConnection(options);
        const a = yield* first.awaitSession;
        const b = yield* second.awaitSession;
        let current: HostConnection | null = first;
        const allocator = new LanguageIdentityEpochs(() => current);

        try {
          const initial = allocator.bind("fixture", a);
          const repeated = allocator.bind("fixture", a);
          const copied = allocator.bind("fixture", { ...a });
          const afterCopy = allocator.lookup("fixture");

          current = second;
          const stale = allocator.lookup("fixture");
          const replacement = allocator.bind("fixture", b);

          current = first;
          const oldRecovered = allocator.bind("fixture", a);
          const newInvalidated = allocator.lookup("fixture");

          return {
            initial,
            repeated,
            copied,
            afterCopy,
            stale,
            replacement,
            oldRecovered,
            newInvalidated,
            aEpoch: a.epoch,
            bEpoch: b.epoch,
          };
        } finally {
          allocator.dispose();
        }
      })
    )
  );

  expect(facts.initial).not.toBeNull();
  expect(facts.repeated).toBe(facts.initial);
  expect(facts.copied).toBeNull();
  expect(facts.afterCopy).toBe(facts.initial);
  expect(facts.aEpoch).toBe(facts.bEpoch);
  expect(facts.replacement?.hostId).toBe(facts.initial?.hostId);
  expect(facts.replacement?.clientId).toBe(facts.initial?.clientId);
  expect(facts.replacement?.connectionEpoch).toBeGreaterThan(facts.initial?.connectionEpoch ?? 0);
  expect(facts.stale).toBeNull();
  expect(facts.oldRecovered).toBeNull();
  expect(facts.newInvalidated).toBeNull();
});

test("abort clears renderer identity and reconnect gets a new monotonic epoch", async () => {
  const facts = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { server, options } = yield* fixture();
        let close: Effect.Effect<void> = Effect.void;

        const connector = Effect.map(socketTransport(server.socketPath), (transport) => {
          close = transport.close;

          return transport;
        });

        const connection = yield* makeHostConnection({ ...options, connector });
        const session = yield* connection.awaitSession;
        const allocator = new LanguageIdentityEpochs(() => connection);

        try {
          const before = allocator.bind("fixture", session);

          yield* close;
          yield* connection.changes.pipe(
            Stream.filter((state) => state.state === "connected" && state.epoch > session.epoch),
            Stream.runHead
          );
          const next = yield* connection.awaitSession;
          const absent = allocator.lookup("fixture");
          const rejected = allocator.bind("fixture", session);
          const restored = allocator.bind("fixture", next);

          allocator.dispose();

          return {
            before,
            absent,
            rejected,
            restored,
            disposed: allocator.lookup("fixture"),
            newRejected: allocator.bind("fixture", next),
          };
        } finally {
          allocator.dispose();
        }
      })
    )
  );

  expect(facts.before).not.toBeNull();
  expect(facts.absent).toBeNull();
  expect(facts.rejected).toBeNull();
  expect(facts.restored?.connectionEpoch).toBeGreaterThan(facts.before?.connectionEpoch ?? 0);
  expect(facts.disposed).toBeNull();
  expect(facts.newRejected).toBeNull();
});

test("Main invalidation blocks unseen ABA and capabilities/unknown keys remain unavailable", async () => {
  const facts = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { options } = yield* fixture();
        const connection = yield* makeHostConnection(options);
        const session = yield* connection.awaitSession;
        const allocator = new LanguageIdentityEpochs(() => connection);

        const partial = yield* makeHostConnection({
          ...options,
          key: "partial",
          identity: { ...identity, capabilities: ["blobs"] },
        });

        const partialSession = yield* partial.awaitSession;
        const partialAllocator = new LanguageIdentityEpochs(() => partial);

        try {
          const before = allocator.bind("fixture", session);
          const noCapability = partialAllocator.bind("partial", partialSession);
          const foreign = allocator.bind("wrong-key", session);
          const missing = allocator.lookup("missing");

          allocator.invalidate("fixture");

          return {
            before,
            foreign,
            missing,
            noCapability,
            recovered: allocator.bind("fixture", session),
          };
        } finally {
          allocator.dispose();
          partialAllocator.dispose();
        }
      })
    )
  );

  expect(facts.before).not.toBeNull();
  expect(facts.noCapability).toBeNull();
  expect(facts.foreign).toBeNull();
  expect(facts.missing).toBeNull();
  expect(facts.recovered).toBeNull();
});

test("preview-only authenticated Hosts receive freshness without Editor identity permission", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { options } = yield* fixture(["languages.preview-media"]);
        const connection = yield* makeHostConnection(options);
        const session = yield* connection.awaitSession;
        const allocator = new LanguageIdentityEpochs(() => connection);

        try {
          const identity = allocator.bind("fixture", session);

          const transport = languageTransportFor(session);

          expect(identity).not.toBeNull();

          if (transport === null) throw new Error("Preview transport missing");
          const access = new LanguageAccess(transport);

          try {
            expect(allocator.lookup("fixture")).toBe(identity);
            expect(() =>
              clientIdentityOf({
                hostId: session.host.hostId,
                connectionEpoch: identity?.connectionEpoch ?? 0,
                access,
                authorizeWorkspace: () => false,
                authorizeCheckout: () => false,
              })
            ).toThrow();
          } finally {
            access.dispose();
          }
        } finally {
          allocator.dispose();
        }
      })
    )
  );
});
