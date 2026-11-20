import { type DesktopSnapshot, type SessionId, InspectionRequest } from "@polaris/protocol";
import { Context, Deferred, Effect, Layer, Queue, Schema, Stream, type Scope } from "effect";

export class InspectionError extends Schema.TaggedError<InspectionError>()("InspectionError", {
  message: Schema.String,
}) {}

interface Client {
  readonly id: number;
  readonly requests: Queue.Queue<typeof InspectionRequest.Type>;
}

/** Only the connection offered a request can answer it; disconnect settles its pending reads. */
export class DesktopInspection extends Context.Service<
  DesktopInspection,
  {
    readonly register: (
      id: number
    ) => Effect.Effect<Stream.Stream<typeof InspectionRequest.Type>, never, Scope.Scope>;
    readonly respond: (
      id: number,
      requestId: string,
      snapshot: DesktopSnapshot | null
    ) => Effect.Effect<void>;
    readonly snapshot: (sessionId: SessionId) => Effect.Effect<DesktopSnapshot, InspectionError>;
  }
>()("polaris/mcp/DesktopInspection") {
  static layer = Layer.effect(
    this,
    Effect.sync(() => {
      const clients = new Map<number, Client>();

      const pending = new Map<
        string,
        { client: Client; result: Deferred.Deferred<DesktopSnapshot, InspectionError> }
      >();

      const unavailable = () => new InspectionError({ message: "No Desktop App connected" });

      return DesktopInspection.of({
        register: (id) =>
          Effect.gen(function* () {
            const requests = yield* Queue.dropping<typeof InspectionRequest.Type>(32);
            const client = { id, requests };

            yield* Effect.acquireRelease(
              Effect.sync(() => clients.set(id, client)),
              () =>
                Effect.gen(function* () {
                  if (clients.get(id) === client) clients.delete(id);

                  for (const [key, request] of pending) {
                    if (request.client !== client) continue;
                    pending.delete(key);
                    yield* Deferred.fail(request.result, unavailable());
                  }

                  yield* Queue.shutdown(requests);
                })
            );

            return Stream.fromQueue(requests);
          }),
        respond: (id, requestId, snapshot) =>
          Effect.gen(function* () {
            const request = pending.get(requestId);

            if (request?.client.id !== id) return;

            yield* snapshot === null
              ? Deferred.fail(
                  request.result,
                  new InspectionError({ message: "The Desktop App couldn't read its current view" })
                )
              : Deferred.succeed(request.result, snapshot);
          }),
        snapshot: (sessionId) =>
          Effect.gen(function* () {
            const client = Array.from(clients.values()).at(-1);

            if (client === undefined) return yield* unavailable();

            if (pending.size >= 32)
              return yield* new InspectionError({
                message: "Too many Desktop App inspections in flight",
              });
            const result = yield* Deferred.make<DesktopSnapshot, InspectionError>();
            const requestId = crypto.randomUUID();

            return yield* Effect.acquireUseRelease(
              Effect.sync(() => pending.set(requestId, { client, result })),
              () =>
                Effect.gen(function* () {
                  yield* Queue.offer(client.requests, { requestId, sessionId });

                  return yield* Deferred.await(result).pipe(
                    Effect.timeoutOrElse({
                      duration: "5 seconds",
                      orElse: () =>
                        Effect.fail(
                          new InspectionError({
                            message: "The Desktop App didn't answer within 5 seconds",
                          })
                        ),
                    })
                  );
                }),
              () =>
                Effect.sync(() => {
                  pending.delete(requestId);
                })
            );
          }),
      });
    })
  );
}
