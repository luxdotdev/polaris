import { Effect, Stream } from "effect";
import { ServerRpcs } from "../transport/rpcs.ts";

/** The module and its Harness adapters load only when a Client asks for a message. */
export const CommitMessageRpcsLive = ServerRpcs.toLayerHandler("commit.suggestMessage", (request) =>
  Stream.unwrap(
    Effect.map(
      Effect.promise(() => import("./suggest.ts")),
      (module) => module.handleSuggest(request)
    )
  )
);
