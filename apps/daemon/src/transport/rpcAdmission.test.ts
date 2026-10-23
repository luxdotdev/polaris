import { expect, test } from "bun:test";
import { HostStreamItem, Sequence } from "@polaris/protocol";
import { Deferred, Effect, Queue, Stream } from "effect";
import { ServerRpcs } from "./rpcs.ts";
import { Ack, admissionSetup, Interrupt } from "./rpcAdmission.testing.ts";

test.each([false, true])(
  "slow Extension RPC flood is bounded (local socket: %s)",
  async (socket) => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          let active = 0;
          let peak = 0;
          const entered = yield* Queue.unbounded<void>();

          const handlers = ServerRpcs.toLayerHandler("harness.spinnerVerbs", () =>
            Effect.gen(function* () {
              active++;
              peak = Math.max(peak, active);
              yield* Queue.offer(entered, undefined);

              return yield* Effect.never;
            }).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  active--;
                })
              )
            )
          );

          const { connect } = yield* admissionSetup(handlers);
          const peer = yield* connect(socket);

          for (let id = 1; id <= 32; id++) yield* peer.request(id);

          for (let id = 1; id <= 32; id++) yield* Queue.take(entered);
          yield* peer.request(33);
          yield* Effect.exit(peer.wire.closed).pipe(Effect.timeout("2 seconds"));
          expect(peak).toBe(32);
          yield* Effect.yieldNow;
          expect(active).toBe(0);
        })
      )
    );
  }
);

test("global admission caps slow handlers across connections without throttling the Desktop", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        let active = 0;
        const entered = yield* Queue.unbounded<void>();

        const handlers = ServerRpcs.toLayerHandler("harness.spinnerVerbs", () =>
          Effect.gen(function* () {
            active++;
            yield* Queue.offer(entered, undefined);

            return yield* Effect.never;
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                active--;
              })
            )
          )
        );

        const { connect } = yield* admissionSetup(handlers);
        const peers = yield* Effect.forEach([0, 1, 2, 3, 4], () => connect());

        for (const peer of peers.slice(0, 4)) {
          for (let id = 1; id <= 32; id++) yield* peer.request(id);
        }

        for (let n = 0; n < 128; n++) yield* Queue.take(entered);
        const desktop = yield* connect(true, false);
        yield* desktop.request(1, "extensions.list");
        expect((yield* Queue.take(desktop.replies))._tag).toBe("Exit");
        yield* peers[4]!.request(1);
        yield* Effect.exit(peers[4]!.wire.closed).pipe(Effect.timeout("2 seconds"));
        expect(active).toBe(128);
        yield* peers[0]!.transport.close;

        // Existing calls keep their slots until their interruption finalizers run.
        for (let n = 0; active > 96 && n < 100; n++) yield* Effect.sleep(10);
        expect(active).toBe(96);
        const replacement = yield* connect();
        yield* replacement.request(1);
        yield* Queue.take(entered);
        expect(active).toBe(97);
      })
    )
  );
});

test("stream Ack and Interrupt remain usable at capacity and cancellation frees a slot", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const entered = yield* Queue.unbounded<void>();
        const cancelled = yield* Deferred.make<void>();

        const handlers = ServerRpcs.toLayerHandler("subscribeHost", () =>
          Stream.concat(
            Stream.succeed(HostStreamItem.cases.Synchronized.make({ sequence: Sequence.make(0) })),
            Stream.fromEffect(Queue.offer(entered, undefined).pipe(Effect.andThen(Effect.never)))
          ).pipe(Stream.ensuring(Deferred.succeed(cancelled, undefined)))
        );

        const { connect } = yield* admissionSetup(handlers);
        const peer = yield* connect();

        for (let id = 1; id <= 32; id++)
          yield* peer.request(id, "subscribeHost", { afterSequence: null });

        for (let id = 1; id <= 32; id++)
          expect((yield* Queue.take(peer.replies))._tag).toBe("Chunk");
        yield* peer.wire.sendJson(JSON.stringify(Ack.make({ requestId: 1 })));
        yield* Queue.take(entered);
        yield* peer.wire.sendJson(JSON.stringify(Interrupt.make({ requestId: 1 })));
        yield* Deferred.await(cancelled);
        expect((yield* Queue.take(peer.replies)).requestId).toBe(1);
        yield* peer.request(33, "subscribeHost", { afterSequence: null });
        expect((yield* Queue.take(peer.replies)).requestId).toBe(33);
        const closed = yield* Effect.forkChild(peer.wire.closed);
        expect(closed.pollUnsafe()).toBeUndefined();
      })
    )
  );
});

test("duplicate request IDs close the peer without replacing an active handler", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        let starts = 0;

        const handlers = ServerRpcs.toLayerHandler("harness.spinnerVerbs", () =>
          Effect.gen(function* () {
            starts++;
            yield* Deferred.succeed(entered, undefined);

            return yield* Effect.never;
          })
        );

        const { connect } = yield* admissionSetup(handlers);
        const peer = yield* connect();
        yield* peer.request(1);
        yield* Deferred.await(entered);
        yield* peer.request(1);
        yield* Effect.exit(peer.wire.closed).pipe(Effect.timeout("2 seconds"));
        expect(starts).toBe(1);
      })
    )
  );
});

test("completed and refused requests release their reservations", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        let starts = 0;

        const handlers = ServerRpcs.toLayerHandler("harness.spinnerVerbs", () =>
          Effect.sync(() => {
            starts++;

            return null;
          })
        );

        const { connect } = yield* admissionSetup(handlers);
        const peer = yield* connect();

        for (let id = 1; id <= 160; id++) {
          const tag = [
            "unknown",
            "extensions.list",
            "harness.spinnerVerbs",
            "harness.spinnerVerbs",
          ][id % 4]!;

          yield* peer.request(id, tag, id % 4 === 2 ? { cwd: 42 } : { cwd: null });
          expect((yield* Queue.take(peer.replies)).requestId).toBe(id);
        }

        expect(starts).toBe(40);
      })
    )
  );
});

test("disconnect does not release global slots while handler cleanup is still running", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const entered = yield* Queue.unbounded<void>();
        const cleaning = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const cleaned = yield* Queue.unbounded<void>();

        const handlers = ServerRpcs.toLayerHandler("harness.spinnerVerbs", () =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Deferred.succeed(cleaning, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.andThen(Queue.offer(cleaned, undefined))
              )
            );
            yield* Queue.offer(entered, undefined);

            return yield* Effect.never;
          })
        );

        const { connect } = yield* admissionSetup(handlers);
        const peers = yield* Effect.forEach([0, 1, 2, 3, 4], () => connect());
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));

        for (const peer of peers.slice(0, 4)) {
          for (let id = 1; id <= 32; id++) yield* peer.request(id);
        }

        for (let n = 0; n < 128; n++) yield* Queue.take(entered);
        yield* peers[0]!.transport.close;
        yield* Deferred.await(cleaning);
        yield* peers[4]!.request(1);
        yield* Effect.exit(peers[4]!.wire.closed).pipe(Effect.timeout("2 seconds"));
        yield* Deferred.succeed(release, undefined);

        for (let n = 0; n < 32; n++) yield* Queue.take(cleaned);
        const replacement = yield* connect();
        yield* replacement.request(1);
        yield* Queue.take(entered);
        yield* replacement.request(2, "unknown");
        expect((yield* Queue.take(replacement.replies)).requestId).toBe(2);
      })
    )
  );
});
