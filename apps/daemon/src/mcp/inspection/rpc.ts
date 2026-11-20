import { InspectionRpcs } from "@polaris/protocol";
import { Effect, Stream } from "effect";
import { DesktopInspection } from "./relay.ts";

export const InspectionRpcHandlers = InspectionRpcs.toLayer(
  Effect.gen(function* () {
    const relay = yield* DesktopInspection;

    return {
      "inspection.watch": (_, { client }) => Stream.unwrap(relay.register(client.id)),
      "inspection.respond": ({ requestId, snapshot }, { client }) =>
        relay.respond(client.id, requestId, snapshot),
    };
  })
);
