import { Context, Effect, Layer, Schema } from "effect";
import { LanguageError } from "@polaris/protocol";
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
    return Layer.sync(ProjectDiscovery, () => {
      const discovery = createProjectDiscovery(options);

      return ProjectDiscovery.of({
        discover: Effect.fn("ProjectDiscovery.discover")((input: DiscoveryInput) =>
          Effect.tryPromise({ try: () => discovery.discover(input), catch: discoveryError })
        ),
        invalidate: Effect.sync(discovery.invalidate),
      });
    });
  }
}
