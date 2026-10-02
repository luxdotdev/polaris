import { Effect, Stream } from "effect";
import { ServerRpcs } from "../transport/rpcs.ts";

/** Inline implementation and Harness adapters load only when a Client requests a proposal. */
export const InlineRpcsLive = ServerRpcs.toLayerHandler("inline.propose", (request) =>
  Stream.unwrap(
    Effect.map(
      Effect.promise(() => import("./proposal.ts")),
      (module) => module.handleInline(request)
    )
  )
);
