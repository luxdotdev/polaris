import { webTools } from "../web/index.ts";
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
import { httpsArtifactDownload } from "../install/download.ts";
import { decodeUpstream, upstreamLimits } from "../install/upstream.ts";
import { createManagedDelivery } from "./managedDelivery.ts";

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

    const probeRoot =
      process.env.POLARIS_BENCH_HARNESS === "1"
        ? process.env.POLARIS_LANGUAGE_PYTHON_PROBE_ROOT
        : undefined;

    const pythonHost =
      probeRoot === undefined ? undefined : { home: probeRoot, directories: [probeRoot] };

    const managed = createManagedDelivery(pythonHost);

    return languageHostHandlers(
      {
        hostId: environment.hostId,
        platform: environment.platform,
        root: join(root, "languages"),
        tools: catalog.tools,
        limits: upstreamLimits,
        sizeProfile: "upstream-runtime",
        managed: managed.delivery,
        adapters: {
          approve: async (exact) => ({
            approved: [
              "node",
              "typescript",
              "typescript-language-server",
              "basedpyright",
              "ruff",
              ...webTools,
            ].includes(exact.tool.id),
            identity: exact.identity,
          }),
          download: httpsArtifactDownload(fetch, upstreamLimits.downloadBytes),
          decode: decodeUpstream,
        },
        observe: (tool, phase, trusted, signal, admission) =>
          managed.observe(tool, phase, trusted, signal, admission),
        disposeObservations: () => managed.dispose(),
      },
      { registry, pythonHost },
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
