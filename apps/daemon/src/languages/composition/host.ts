import { createSqlSelection, SqlSelection } from "../sql/selection.ts";
import { developerLaunchAdapters, developerProvider } from "../go/launch.ts";
import { createHostPrerequisiteProbe } from "../install/hostStateProbes.ts";
import { SqlCore } from "../sql/core.ts";
import { createProcessSettings } from "../runtime/processSettings.ts";
import { LanguageProcessBudgetCore } from "./processBudget.ts";
import { webProviders } from "../web/index.ts";
import { managedProviderIds, providerAvailability } from "./managedAvailability.ts";
import { PrivateNodeRuntime } from "./privateNode.ts";
import { createPythonEnvironment, PythonEnvironment } from "../python/environment.ts";
import { PythonCore } from "../python/core.ts";
import { join } from "node:path";
import { LanguageResourceEdits } from "./resourceEdits.ts";
import { LanguageResourceReceiptAuthority } from "./resourceEditsAuthority.ts";
import { languageResourceEditHandlers } from "./resourceEditsHandlers.ts";
import { Context, Effect, Layer, Schema } from "effect";
import { LanguageError } from "@polaris/protocol";
import { ProposalPreparation } from "../preparation/index.ts";
import { ProposalProvenance } from "../preparation/provenanceService.ts";
import { catalog } from "../catalog/index.ts";
import { ProjectDiscovery, type DiscoveryFacts } from "../discovery/index.ts";
import type { LaunchAdmissionRequest } from "../runtime/launchAdmission.ts";
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
import { LanguageHostStateCore } from "./hostState.ts";
import { languageCoreHandlers } from "./index.ts";
import type { ManagedDelivery } from "./managedDelivery.ts";

type HostOptions = Omit<HostInstallationOptions, "reserveSelection"> & {
  managed?: ManagedDelivery;
};

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
  options: HostOptions,
  discoveryOptions: Parameters<typeof ProjectDiscovery.layer>[0],
  trustOptions: Parameters<typeof ExecutionTrustService.layer>[0],
  trustGrants = LanguageTrustGrantAuthority.denyLayer
) => {
  const sql = createSqlSelection(join(options.root, "sql-dialects"));
  const python = createPythonEnvironment(join(options.root, "python-interpreters"));
  const authority = LanguageAcquisitionAuthority.layer;
  const trust = ExecutionTrustService.layer(trustOptions);

  const discovery = ProjectDiscovery.layer({
    ...discoveryOptions,
    pythonEnvironment: python,
    sqlSelection: sql,
    bundledTypeScript: options.managed !== undefined,
  }).pipe(Layer.provide(trust));

  const shared = Layer.mergeAll(
    Layer.succeed(PythonEnvironment)(python),
    Layer.succeed(SqlSelection)(sql),
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

      options.managed?.bind(host);

      const installationLayer = HostLanguageInstallation.layer(host);

      const providers = Layer.effect(
        LanguageProviderAccess,
        Effect.gen(function* () {
          const owners = yield* LanguageAcquisitionAuthority;
          const executionTrust = yield* ExecutionTrustService;
          const installation = yield* HostLanguageInstallation;

          const adapters = managedLaunchAdapters({
            host,
            pinnedProviders: options.managed === undefined ? [] : managedProviderIds,
            ledger,
            plan: options.managed?.plan,
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

          const developer = developerLaunchAdapters(
            ledger,
            createHostPrerequisiteProbe(discoveryOptions.pythonHost)
          );

          const launchAdapters = (facts: DiscoveryFacts) =>
            configuredExecutable(facts) !== undefined
              ? configured
              : developerProvider(facts.providerId)
                ? developer
                : undefined;

          return LanguageProviderAccess.of({
            availability: (toolId, phase, trusted, admission, settings) =>
              providerAvailability(
                installation,
                options.managed,
                toolId,
                phase,
                trusted,
                admission,
                settings
              ),
            reserveLaunch: (request) =>
              (
                launchAdapters(request.facts) ?? {
                  reserveLaunch: async (request: LaunchAdmissionRequest) => {
                    if (
                      [
                        "typescript-language-server",
                        "basedpyright",
                        "ruff",
                        ...Object.keys(webProviders),
                        "bash-language-server",
                        "sqllens-language-server",
                        "phpactor",
                      ].includes(request.facts.providerId) &&
                      options.managed !== undefined
                    ) {
                      const guard = owners.guard(request, executionTrust).validate;
                      await options.managed.ensure(
                        request.facts.effectiveSettings,
                        { cwd: request.facts.projectRoot, requireCurrent: guard },
                        request.signal,
                        request.facts.providerId
                      );
                    }

                    return adapters.reserveLaunch(request);
                  },
                }
              ).reserveLaunch(request),
            resolveLaunch: (facts, lease, request) =>
              (launchAdapters(facts) ?? adapters).resolveLaunch(facts, lease, request),
          });
        })
      ).pipe(Layer.provide(installationLayer), Layer.provide(shared));

      const processSettings = yield* Effect.tryPromise({
        try: () => createProcessSettings(options.hostId, options.root),
        catch: installationError,
      });

      const broker = languageBrokerLayer({
        hostId: options.hostId,
        processLimit: processSettings.snapshot().effectiveLimit,
      }).pipe(Layer.provide(providers), Layer.provide(shared));

      const receipts = LanguageResourceReceiptAuthority.layer.pipe(
        Layer.provide(broker),
        Layer.provide(shared)
      );

      const resources = LanguageResourceEdits.layer({
        hostId: options.hostId,
        journalRoot: join(options.root, "resource-journals"),
      }).pipe(Layer.provide(broker), Layer.provide(receipts), Layer.provide(shared));

      return Layer.mergeAll(
        Layer.succeed(HostLanguageResources)({ host, ledger }),
        installationLayer,
        PrivateNodeRuntime.layer.pipe(Layer.provide(installationLayer)),
        LanguageHostStateCore.layer(options.hostId, host),
        LanguageProcessBudgetCore.layer(options.hostId, processSettings).pipe(
          Layer.provide(broker)
        ),
        LanguageInstallCore.layer(options.hostId, host).pipe(
          Layer.provide(LanguageInstallGrantAuthority.denyLayer)
        ),
        PythonCore.layer(options.hostId, discoveryOptions.pythonHost).pipe(
          Layer.provide(broker),
          Layer.provide(shared)
        ),
        SqlCore.layer(options.hostId).pipe(Layer.provide(broker), Layer.provide(shared)),
        providers,
        resources,
        broker
      ).pipe(Layer.provideMerge(trustGrants), Layer.provideMerge(shared));
    })
  );
};

export const languageHostHandlers = (
  options: HostOptions,
  discoveryOptions: Parameters<typeof ProjectDiscovery.layer>[0],
  trustOptions: Parameters<typeof ExecutionTrustService.layer>[0],
  trustGrants = LanguageTrustGrantAuthority.denyLayer
) =>
  Layer.mergeAll(languageCoreHandlers(options.hostId), languageResourceEditHandlers).pipe(
    Layer.provide(languageHostServices(options, discoveryOptions, trustOptions, trustGrants))
  );
