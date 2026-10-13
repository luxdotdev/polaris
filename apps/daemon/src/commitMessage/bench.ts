import { Effect, Schema } from "effect";
import { HarnessError } from "../harness/HarnessDriver.ts";
import type { MessageBackend } from "./backend.ts";
import { decodeMessage } from "./prompt.ts";

/** `model: "bench:{...}"` scripts the output, a delay (for cancellation) or a failure. */
const Script = Schema.Struct({
  message: Schema.optionalKey(Schema.Unknown),
  delayMs: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  fail: Schema.optionalKey(Schema.String),
});

const firstFile = (prompt: string) =>
  /^Staged files \(\d+\):\n\s*(\S+)/mu.exec(prompt)?.[1] ?? "the staged files";

export const benchMessage: MessageBackend = Effect.fn("commitMessage.bench")(
  function* (harness, job, _cwd, progress) {
    const script = job.model?.startsWith("bench:")
      ? yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Script))(job.model.slice(6)).pipe(
          Effect.mapError(() => new HarnessError({ harness, message: "Invalid bench script" }))
        )
      : {};

    yield* progress("Drafting a scripted message");
    yield* Effect.sleep(script.delayMs ?? 0);

    if (script.fail !== undefined)
      return yield* new HarnessError({ harness, message: script.fail });

    return yield* decodeMessage(
      script.message ?? { subject: `Update ${firstFile(job.prompt)}`, body: "" }
    );
  }
);
