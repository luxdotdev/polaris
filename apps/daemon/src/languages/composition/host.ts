import { join } from "node:path";
import { LanguageResourceEdits } from "./resourceEdits.ts";
import { LanguageResourceReceiptAuthority } from "./resourceEditsAuthority.ts";
import { languageResourceEditHandlers } from "./resourceEditsHandlers.ts";
import { Context, Effect, Layer, Schema } from "effect";
import { LanguageError } from "@polaris/protocol";
import { ProposalPreparation } from "../preparation/index.ts";
import { ProposalProvenance } from "../preparation/provenanceService.ts";
import { catalog } from "../catalog/index.ts";
import { ProjectDiscovery } from "../discovery/index.ts";
import { ExecutionTrustService } from "../trust/index.ts";
import {
  createHostInstallations,
  type HostInstallation,
  type HostInstallationOptions,
} from "../install/host.ts";
import type { ExactArtifact } from "../install/types.ts";
import { createSelectionLedger } from "../install/selection-ledger.ts";
import { HostLanguageInstallation } from "../availability/service.ts";
import { configuredExecutable, configuredLaunchAdapters } from "./configuredLaunch.ts";
import { managedLaunchAdapters } from "../availability/launch.ts";
import { LanguageAcquisitionAuthority } from "./acquisitionAuthority.ts";
import {
  LanguageProviderAccess,
  LanguageTrustGrantAuthority,
  languageBrokerLayer,
} from "./ports.ts";
import { LanguageInstallCore, LanguageInstallGrantAuthority } from "./install.ts";
import { languageCoreHandlers } from "./index.ts";

const installationError = (cause: unknown) =>
  Schema.is(LanguageError)(cause)
    ? cause
    : new LanguageError({
        reason: "install-failed",
        message: "Host language services could not be initialized",
        retryable: false,
      });

/** Private Host-scoped resources reused by installer routes and runtime admission. */
export class HostLanguageResources extends Context.Service<
  HostLanguageResources,
  { host: HostInstallation; ledger: ReturnType<typeof createSelectionLedger> }
>()("polaris/languages/HostLanguageResources") {}

/** One Host registry and selection ledger outlive their broker's owned shutdown. */
export const languageHostServices = (
  options: Omit<HostInstallationOptions, "reserveSelection">,
  discoveryOptions: Parameters<typeof ProjectDiscovery.layer>[0],
  trustOptions: Parameters<typeof ExecutionTrustService.layer>[0],
  trustGrants = LanguageTrustGrantAuthority.denyLayer
) => {
  const authority = LanguageAcquisitionAuthority.layer;
  const trust = ExecutionTrustService.layer(trustOptions);
  const discovery = ProjectDiscovery.layer(discoveryOptions);

  const shared = Layer.mergeAll(
    authority,
    trust,
    discovery,
    ProposalProvenance.layer,
    ProposalPreparation.layer
  );

  return Layer.unwrap(
    Effect.gen(function* () {
      const registry = createHostInstallations();
      const ledger = createSelectionLedger();

      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await registry.dispose();
          ledger.dispose();
        })
      );

      const immutableOptions: HostInstallationOptions = Object.freeze({
        ...options,
        reserveSelection: (exact: ExactArtifact, signal: AbortSignal) =>
          ledger.reserveSelection(exact.tool.id, signal),
      });

      const host = yield* Effect.tryPromise({
        try: () => registry.get(immutableOptions),
        catch: installationError,
      });

      const installationLayer = HostLanguageInstallation.layer(host);

      const providers = Layer.effect(
        LanguageProviderAccess,
        Effect.gen(function* () {
          const owners = yield* LanguageAcquisitionAuthority;
          const executionTrust = yield* ExecutionTrustService;
          const installation = yield* HostLanguageInstallation;

          const adapters = managedLaunchAdapters({
            host,
            ledger,
            toolId: (facts) => {
              const provider = catalog.integrations
                .flatMap((integration) => integration.providers)
                .find((candidate) => candidate.id === facts.providerId);

              if (provider === undefined)
                throw new LanguageError({
                  reason: "method-not-found",
                  message: "Provider is not in the accepted catalog",
                  retryable: false,
                });

              return provider.tool;
            },
            requireCurrent: (request) => owners.guard(request, executionTrust).validate,
          });

          const configured = configuredLaunchAdapters(ledger);

          return LanguageProviderAccess.of({
            availability: (toolId, phase, trusted, admission) =>
              installation.inspect(toolId, phase, trusted, admission),
            reserveLaunch: (request) =>
              configuredExecutable(request.facts) === undefined
                ? adapters.reserveLaunch(request)
                : configured.reserveLaunch(request),
            resolveLaunch: (facts, lease, request) =>
              configuredExecutable(facts) === undefined
                ? adapters.resolveLaunch(facts, lease, request)
                : configured.resolveLaunch(facts, lease, request),
          });
        })
      ).pipe(Layer.provide(installationLayer), Layer.provide(shared));

      const broker = languageBrokerLayer({ hostId: options.hostId }).pipe(
        Layer.provide(providers),
        Layer.provide(shared)
      );

      const receipts = LanguageResourceReceiptAuthority.layer.pipe(
        Layer.provide(broker),
        Layer.provide(shared)
      );

      const resources = LanguageResourceEdits.layer({
        hostId: options.hostId,
        journalRoot: join(options.root, "resource-journals"),
      }).pipe(Layer.provide(receipts), Layer.provide(shared));

      return Layer.mergeAll(
        Layer.succeed(HostLanguageResources)({ host, ledger }),
        installationLayer,
        LanguageInstallCore.layer(options.hostId, host).pipe(
          Layer.provide(LanguageInstallGrantAuthority.denyLayer)
        ),
        providers,
        resources,
        broker
      ).pipe(Layer.provideMerge(trustGrants), Layer.provideMerge(shared));
    })
  );
};

export const languageHostHandlers = (
  options: Omit<HostInstallationOptions, "reserveSelection">,
  discoveryOptions: Parameters<typeof ProjectDiscovery.layer>[0],
  trustOptions: Parameters<typeof ExecutionTrustService.layer>[0],
  trustGrants = LanguageTrustGrantAuthority.denyLayer
) =>
  Layer.mergeAll(languageCoreHandlers(options.hostId), languageResourceEditHandlers).pipe(
    Layer.provide(languageHostServices(options, discoveryOptions, trustOptions, trustGrants))
  );
