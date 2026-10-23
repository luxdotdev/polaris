import { expect, test } from "bun:test";
import { encodeBlobFrame } from "@polaris/protocol";
import { Effect, Layer, Queue } from "effect";
import { admissionSetup } from "../transport/rpcAdmission.testing.ts";

test("the mounted gateway closes a paired Extension on its 129th unclaimed empty blob", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { connect } = yield* admissionSetup(Layer.empty);
        const peer = yield* connect();

        for (let id = 0; id < 128; id++) {
          yield* peer.transport.write(encodeBlobFrame(String(id), new Uint8Array(), true));
        }

        yield* peer.request(1, "unknown");
        expect((yield* Queue.take(peer.replies)).requestId).toBe(1);
        yield* peer.transport.write(encodeBlobFrame("overflow", new Uint8Array(), true));
        yield* Effect.exit(peer.wire.closed).pipe(Effect.timeout("2 seconds"));
      })
    )
  );
});
