import { Context, Effect, Layer, Schema } from "effect";
import { LanguageError } from "@polaris/protocol";
import type { LanguageCheckout, LanguageTrust } from "@polaris/protocol";
import { createExecutionTrust } from "./index.ts";
import type { CanonicalCheckout } from "./checkout.ts";

const trustError = (cause: unknown) =>
  Schema.is(LanguageError)(cause)
    ? cause
    : new LanguageError({
        reason: "awaiting-trust",
        message: "Unable to verify checkout execution trust",
        retryable: true,
      });

export class ExecutionTrustService extends Context.Service<
  ExecutionTrustService,
  {
    inspect: (
      checkout: LanguageCheckout
    ) => Effect.Effect<
      { canonical: CanonicalCheckout; trust: typeof LanguageTrust.Type },
      LanguageError
    >;
    set: (
      checkout: LanguageCheckout,
      trusted: boolean,
      expectedRevision: number
    ) => Effect.Effect<typeof LanguageTrust.Type, LanguageError>;
    require: (checkout: LanguageCheckout) => Effect.Effect<CanonicalCheckout, LanguageError>;
  }
>()("polaris/languages/ExecutionTrust") {
  static layer(options: Parameters<typeof createExecutionTrust>[0]) {
    return Layer.sync(ExecutionTrustService, () => {
      const trust = createExecutionTrust(options);

      return ExecutionTrustService.of({
        inspect: Effect.fn("ExecutionTrust.inspect")((checkout: LanguageCheckout) =>
          Effect.tryPromise({ try: () => trust.inspect(checkout), catch: trustError })
        ),
        set: Effect.fn("ExecutionTrust.set")(
          (checkout: LanguageCheckout, trusted: boolean, expectedRevision: number) =>
            Effect.tryPromise({
              try: () => trust.set(checkout, trusted, expectedRevision),
              catch: trustError,
            })
        ),
        require: Effect.fn("ExecutionTrust.require")((checkout: LanguageCheckout) =>
          Effect.tryPromise({ try: () => trust.require(checkout), catch: trustError })
        ),
      });
    });
  }
}
