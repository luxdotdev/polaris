import { InlineError, InlinePatch } from "@polaris/protocol";
import { Effect, Schema } from "effect";
import type { InlineBackend } from "./backend.ts";
import { decodePatch } from "./patch.ts";

const Script = Schema.Struct({
  patch: Schema.Unknown,
  delayMs: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});

export const benchInline: InlineBackend = Effect.fn("inline.bench")(
  function* (request, _cwd, progress) {
    const script = request.prompt.startsWith("bench:")
      ? yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Script))(
          request.prompt.slice(6)
        ).pipe(
          Effect.mapError(
            () =>
              new InlineError({ reason: "invalid-request", message: "Invalid bench inline script" })
          )
        )
      : {
          patch: InlinePatch.make({
            replacements: [{ ...request.selection, text: "// Inline bench proposal\n" }],
            summary: "Scripted inline edit",
          }),
          delayMs: 0,
        };

    yield* progress("Preparing a scripted proposal");
    yield* Effect.sleep(script.delayMs ?? 0);

    return yield* decodePatch(script.patch);
  }
);
