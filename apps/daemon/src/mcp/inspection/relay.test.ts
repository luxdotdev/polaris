import { expect, test } from "bun:test";
import { Effect, Exit, Fiber, Option, Scope, Stream, Deferred } from "effect";
import { RpcTest } from "effect/rpc";
import { InspectionRpcs } from "@polaris/protocol";
import { workerBinding } from "../testing.ts";
import { DesktopInspection } from "./relay.ts";
import { InspectionRpcHandlers } from "./rpc.ts";

test("a renderer snapshot round-trips only through the connection it was offered to", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const relay = yield* DesktopInspection;
        const requests = yield* relay.register(1);
        const result = yield* relay.snapshot(workerBinding.sessionId).pipe(Effect.forkChild);
        const request = yield* Stream.runHead(requests);

        if (Option.isNone(request)) throw new Error("No snapshot request");

        yield* relay.respond(2, request.value.requestId, { capturedAt: 0, windows: [] });

        yield* relay.respond(1, request.value.requestId, { capturedAt: 123, windows: [] });
        expect(yield* Fiber.join(result)).toEqual({ capturedAt: 123, windows: [] });
      })
    ).pipe(Effect.provide(DesktopInspection.layer))
  ));

test("no Desktop App fails promptly and closing its stream settles pending reads", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const relay = yield* DesktopInspection;
        expect(yield* relay.snapshot(workerBinding.sessionId).pipe(Effect.flip)).toMatchObject({
          message: "No Desktop App connected",
        });

        const scope = yield* Scope.make();
        const requests = yield* relay.register(1).pipe(Effect.provideService(Scope.Scope, scope));

        const result = yield* relay
          .snapshot(workerBinding.sessionId)
          .pipe(Effect.flip, Effect.forkChild);

        yield* Stream.runHead(requests);
        yield* Scope.close(scope, Exit.void);
        expect(yield* Fiber.join(result)).toMatchObject({ message: "No Desktop App connected" });
      })
    ).pipe(Effect.provide(DesktopInspection.layer))
  ));

test("canceling snapshot reads releases the pending-read budget", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const relay = yield* DesktopInspection;
        const requests = yield* relay.register(1);

        for (let index = 0; index < 33; index++) {
          const result = yield* relay.snapshot(workerBinding.sessionId).pipe(Effect.forkChild);
          yield* Stream.runHead(requests);
          yield* Fiber.interrupt(result);
        }

        const result = yield* relay.snapshot(workerBinding.sessionId).pipe(Effect.forkChild);
        const request = yield* Stream.runHead(requests);

        if (Option.isNone(request)) throw new Error("No snapshot request");
        yield* relay.respond(1, request.value.requestId, { capturedAt: 42, windows: [] });
        expect(yield* Fiber.join(result)).toEqual({ capturedAt: 42, windows: [] });
      })
    ).pipe(Effect.provide(DesktopInspection.layer))
  ));

test("Desktop inspection RPCs deliver the request and decode its renderer response", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const relay = yield* DesktopInspection;
        const registered = yield* Deferred.make<void>();

        const client = yield* RpcTest.makeClient(InspectionRpcs).pipe(
          Effect.provide(InspectionRpcHandlers),
          Effect.provideService(DesktopInspection, {
            ...relay,
            register: (id) =>
              relay.register(id).pipe(Effect.tap(() => Deferred.succeed(registered, undefined))),
          })
        );

        yield* client["inspection.watch"]({}).pipe(
          Stream.runForEach(({ requestId, sessionId }) => {
            expect(sessionId).toBe(workerBinding.sessionId);

            return client["inspection.respond"]({
              requestId,
              snapshot: { capturedAt: 321, windows: [] },
            });
          }),
          Effect.forkChild
        );
        yield* Deferred.await(registered);
        expect(yield* relay.snapshot(workerBinding.sessionId)).toEqual({
          capturedAt: 321,
          windows: [],
        });
      })
    ).pipe(Effect.provide(DesktopInspection.layer))
  ));
