import { type Attempt, RemotePlacementRequest, RemotePlacementResponse } from "@polaris/protocol";
import { Context, Effect, Layer, Predicate, Schema, Stream, SubscriptionRef } from "effect";
import { transferError } from "../worktrees.ts";
import { TransferStorage } from "./storage.ts";

const requestCodec = Schema.fromJsonString(RemotePlacementRequest);

const responseCodec = Schema.fromJsonString(RemotePlacementResponse);

const encodeRequest = Schema.encodeSync(requestCodec);

const decodeRequest = Schema.decodeUnknownSync(requestCodec);

const decodeResponse = Schema.decodeUnknownSync(responseCodec);

export class RemotePlacements extends Context.Service<
  RemotePlacements,
  {
    readonly request: (
      request: RemotePlacementRequest
    ) => Effect.Effect<Attempt, import("@polaris/protocol").ConstellationTransferError>;
    readonly resolve: (
      id: string,
      response: RemotePlacementResponse
    ) => Effect.Effect<void, import("@polaris/protocol").ConstellationTransferError>;
    readonly watch: Stream.Stream<
      ReadonlyArray<RemotePlacementRequest>,
      import("@polaris/protocol").ConstellationTransferError
    >;
  }
>()("polaris/constellation/RemotePlacements") {
  static readonly layer = Layer.effect(
    RemotePlacements,
    Effect.gen(function* () {
      const storage = yield* TransferStorage;
      const changes = yield* SubscriptionRef.make(0);

      const pending = Effect.gen(function* () {
        const requests = (yield* storage.requests).map((s) => decodeRequest(s));
        const result: Array<RemotePlacementRequest> = [];

        for (const request of requests)
          if (yield* storage.get("responses", request.id).pipe(Effect.map((r) => r === null)))
            result.push(request);

        return result;
      });

      return RemotePlacements.of({
        watch: SubscriptionRef.changes(changes).pipe(Stream.mapEffect(() => pending)),
        request: Effect.fnUntraced(function* (request) {
          const encoded = encodeRequest(request);
          const previous = yield* storage.get("requests", request.id);

          if (previous !== null && previous !== encoded)
            return yield* transferError(
              "E-IDEMPOTENCY",
              "The remote placement ID names another request"
            );
          yield* storage.put("requests", request.id, encoded);
          yield* SubscriptionRef.update(changes, (n) => n + 1);

          const responses = SubscriptionRef.changes(changes).pipe(
            Stream.mapEffect(() => storage.get("responses", request.id)),
            Stream.filter((r): r is string => r !== null),
            Stream.take(1),
            Stream.runCollect
          );

          const result = yield* responses.pipe(
            Effect.timeout("30 seconds"),
            Effect.catchTag("TimeoutError", () =>
              Effect.fail(
                transferError(
                  "E-CLIENT-OFFLINE",
                  "Remote preparation is waiting for the Desktop App; retry this command after reconnecting",
                  true
                )
              )
            )
          );

          const response = decodeResponse(result[0]!);

          return Predicate.isTagged(response, "Prepared")
            ? response.attempt
            : yield* response.error;
        }),
        resolve: Effect.fnUntraced(function* (id, response) {
          const encoded = yield* storage.get("requests", id);

          if (encoded === null)
            return yield* transferError(
              "E-NOT-FOUND",
              "The remote placement request does not exist"
            );
          const request = decodeRequest(encoded);

          if (Predicate.isTagged(response, "Prepared")) {
            const a = response.attempt;

            if (
              a.hostId !== request.worker.hostId ||
              a.taskId !== request.task.id ||
              a.base !== request.baseHead ||
              a.state !== "working" ||
              a.claim !== null
            )
              return yield* transferError(
                "E-PLACEMENT",
                "The prepared Attempt does not match its request"
              );
          }

          const value = Schema.encodeSync(responseCodec)(response);
          const previous = yield* storage.get("responses", id);

          if (previous !== null && previous !== value)
            return yield* transferError(
              "E-IDEMPOTENCY",
              "The remote placement already has another response"
            );
          yield* storage.put("responses", id, value);
          yield* SubscriptionRef.update(changes, (n) => n + 1);
        }),
      });
    })
  );
}
