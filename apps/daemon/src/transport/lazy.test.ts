import { expect, test } from "bun:test";
import { BlobId } from "@polaris/protocol";
import { Effect, Layer, Schema, Stream } from "effect";
import { Headers } from "effect/http";
import { Rpc, RpcGroup } from "effect/rpc";
import { RequestId } from "effect/rpc/RpcMessage";
import { BlobChannel } from "../services.ts";
import { ConnectionBlobs } from "./rpcs.ts";
import { lazyRpcLayer } from "./lazy.ts";

const rpcs = RpcGroup.make(
  Rpc.make("test.read", { success: Schema.String }),
  Rpc.make("test.watch", { success: Schema.String, stream: true })
).middleware(ConnectionBlobs);

const blobs = (name: string): BlobChannel["Service"] => ({
  offer: () => Effect.succeed(BlobId.make(name)),
  take: () => Effect.succeed(new Uint8Array()),
  takeStream: () => Stream.empty,
});

test("lazy RPCs share one Daemon build while streams retain request Scope and BlobChannel", async () => {
  let builds = 0;
  let closed = 0;
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const daemon = yield* Effect.scope;
        const memo = yield* Layer.makeMemoMap;

        const read = Effect.gen(function* () {
          expect(yield* Effect.scope).not.toBe(daemon);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              closed++;
            })
          );

          return yield* (yield* BlobChannel).offer(new Uint8Array());
        });

        const load = yield* Effect.cached(
          Effect.andThen(
            Effect.sync(() => {
              builds++;
            }),
            rpcs.toHandlers({
              "test.read": () => read,
              "test.watch": () => Stream.fromEffect(read),
            })
          ).pipe(Effect.provideService(BlobChannel, blobs("daemon")))
        );

        const handlers = yield* Layer.buildWithMemoMap(lazyRpcLayer(rpcs, load), memo, daemon);
        expect(builds).toBe(0);

        const options = {
          requestId: RequestId(1),
          headers: Headers.empty,
          client: new Rpc.ServerClient(1),
        };

        const request = Effect.scoped(
          Effect.gen(function* () {
            const read = yield* rpcs.accessHandler("test.read");

            return yield* read(undefined, options);
          })
        );

        const results = yield* Effect.all(
          [
            request.pipe(Effect.provideService(BlobChannel, blobs("one"))),
            request.pipe(Effect.provideService(BlobChannel, blobs("two"))),
          ],
          { concurrency: "unbounded" }
        ).pipe(Effect.provide(handlers));

        expect(results).toEqual(["one", "two"]);
        expect(builds).toBe(1);
        expect(closed).toBe(2);

        const values = yield* Effect.scoped(
          Effect.gen(function* () {
            const watch = yield* rpcs.accessHandler("test.watch");
            const result = watch(undefined, options);

            return yield* (Effect.isEffect(result) ? Stream.fromQueue(yield* result) : result).pipe(
              Stream.runCollect
            );
          })
        ).pipe(Effect.provide(handlers), Effect.provideService(BlobChannel, blobs("stream")));

        expect(values).toEqual(["stream"]);
        expect(closed).toBe(3);
        expect(builds).toBe(1);
      })
    )
  );
});

test("empty startup leaves transfer storage absent; persisted assignments activate recovery", async () => {
  const { Database } = await import("bun:sqlite");
  const { mkdtempSync, rmSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { emptyModel } = await import("../store/model.ts");

  const { constellationTransferPath, needsConstellationStartup } =
    await import("../constellation/composition/startup.ts");

  const root = mkdtempSync(join(tmpdir(), "polaris-lazy-startup-"));
  const path = constellationTransferPath(root);

  try {
    expect(await Effect.runPromise(needsConstellationStartup(root, emptyModel))).toBe(false);
    expect(existsSync(path)).toBe(false);
    const db = new Database(path, { create: true });
    db.exec("CREATE TABLE assignments (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
    expect(await Effect.runPromise(needsConstellationStartup(root, emptyModel))).toBe(false);
    db.exec("INSERT INTO assignments VALUES ('mirror', '{}')");
    expect(await Effect.runPromise(needsConstellationStartup(root, emptyModel))).toBe(true);
    db.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
