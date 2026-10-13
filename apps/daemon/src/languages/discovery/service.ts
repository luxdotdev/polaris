import { Context, Effect, Layer, Option, Schema } from "effect";
import { LanguageError } from "@polaris/protocol";
import { ExecutionTrustService } from "../trust/service.ts";
import { createProjectDiscovery, type DiscoveryInput, type DiscoveryFacts } from "./index.ts";

const discoveryError = (cause: unknown) =>
  Schema.is(LanguageError)(cause)
    ? cause
    : new LanguageError({
        reason: "invalid-input",
        message: "Unable to discover checkout configuration",
        retryable: true,
      });

export class ProjectDiscovery extends Context.Service<
  ProjectDiscovery,
  {
    discover: (input: DiscoveryInput) => Effect.Effect<DiscoveryFacts, LanguageError>;
    invalidate: Effect.Effect<void>;
  }
>()("polaris/languages/ProjectDiscovery") {
  static layer(options: Parameters<typeof createProjectDiscovery>[0]) {
    return Layer.effect(
      ProjectDiscovery,
      Effect.gen(function* () {
        const trust = yield* Effect.serviceOption(ExecutionTrustService);
        const discovery = createProjectDiscovery(options);

        return ProjectDiscovery.of({
          discover: Effect.fn("ProjectDiscovery.discover")((input: DiscoveryInput) =>
            Effect.gen(function* () {
              const observed = Option.isSome(trust)
                ? yield* trust.value.inspect(input.checkout)
                : null;

              return yield* Effect.tryPromise({
                try: () =>
                  discovery.discover({
                    ...input,
                    workspaceTrusted: observed?.trust.trusted === true,
                    useProjectTypeScript:
                      observed?.trust.trusted === true &&
                      observed.trust.typescriptProvider !== "bundled",
                  }),
                catch: discoveryError,
              });
            })
          ),
          invalidate: Effect.sync(discovery.invalidate),
        });
      })
    );
  }
}
