import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { LanguageError } from "@polaris/protocol";
import { EventStore } from "../../store/EventStore.ts";
import { catalog } from "../catalog/index.ts";
import { registeredCheckout } from "../registeredCheckout.ts";
import { createFileTrustRepository } from "../trust/index.ts";
import { HostLanguageEnvironment } from "./environment.ts";
import { authenticatedTrustGrants } from "./trustGrant.ts";
import { languageHostHandlers } from "./host.ts";

const unavailable = () =>
  new LanguageError({
    reason: "audit-required",
    message: "Managed artifact delivery has not been approved",
    retryable: false,
  });

/** Core registration uses one Host service graph; approved delivery and grants remain separate authorities. */
export const DefaultLanguageHostHandlers = Layer.unwrap(
  Effect.gen(function* () {
    const environment = yield* HostLanguageEnvironment;
    const store = yield* EventStore;

    if (environment.platform === null)
      return yield* Effect.fail(
        new LanguageError({
          reason: "unsupported-platform",
          message: "Language services are unavailable on this Host platform",
          retryable: false,
        })
      );

    const root = yield* Effect.tryPromise({
      try: () => realpath(environment.root),
      catch: () =>
        new LanguageError({
          reason: "invalid-input",
          message: "Private Daemon directory is unavailable",
          retryable: false,
        }),
    });

    const registry = async (checkout: Parameters<typeof registeredCheckout>[1]) =>
      registeredCheckout(await Effect.runPromise(store.model), checkout);

    return languageHostHandlers(
      {
        hostId: environment.hostId,
        platform: environment.platform,
        root: join(root, "languages"),
        tools: catalog.tools,
        adapters: {
          approve: async (exact) => ({ approved: false, identity: exact.identity }),
          download: async function* () {
            yield* [];
            throw unavailable();
          },
          decode: async () => {
            throw unavailable();
          },
        },
        observe: async (tool) => {
          if (tool.requirements.length > 0)
            throw new LanguageError({
              reason: "not-ready",
              message: "Host prerequisite observation is unavailable",
              retryable: false,
            });

          return { connected: true, probes: [] };
        },
      },
      { registry },
      {
        hostId: environment.hostId,
        registry,
        repository: createFileTrustRepository(join(root, "language-trust")),
        // Core checks the exact connection and registered scope before this private persistence port.
        authorizeGrant: async () => {},
      },
      authenticatedTrustGrants(environment.hostId)
    );
  })
);
