import type { CurrentLanguageConnection } from "../../transport/currentLanguageConnection.ts";
import type { EventStore } from "../../store/EventStore.ts";
import { Context, Effect, Layer } from "effect";
import {
  LanguageError,
  type LanguageConnectionIdentity,
  type LanguageTrustScope,
  type LanguageAvailability,
  type HostId,
  type LanguagePlatform,
} from "@polaris/protocol";
import { catalog } from "../catalog/index.ts";
import { availability } from "../availability/index.ts";
import type { LaunchAdmissionRequest, LaunchSelectionLease } from "../runtime/launchAdmission.ts";
import type { DiscoveryFacts } from "../discovery/index.ts";
import { LanguageBroker, type BrokerOptions, type Launch } from "../runtime/index.ts";
import { ExecutionTrustService } from "../trust/index.ts";
import { LanguageAcquisitionAuthority } from "./acquisitionAuthority.ts";
import { guardedLaunchAccess } from "./launchAccess.ts";
import { ProposalProvenance } from "../preparation/provenanceService.ts";
import { prepareServerEdit } from "./serverPreparation.ts";
import type { ObservationAdmission } from "../install/host.ts";

/** I1 supplies approved installed-version observations and launch resolution; this port never installs. */
export class LanguageProviderAccess extends Context.Service<
  LanguageProviderAccess,
  {
    availability: (
      toolId: string,
      phase: "install" | "feature",
      trusted: boolean,
      admission?: ObservationAdmission
    ) => Effect.Effect<LanguageAvailability, LanguageError>;
    reserveLaunch: (request: LaunchAdmissionRequest) => Promise<LaunchSelectionLease>;
    resolveLaunch: (
      facts: DiscoveryFacts,
      lease: LaunchSelectionLease,
      request: LaunchAdmissionRequest
    ) => Promise<Launch>;
  }
>()("polaris/languages/LanguageProviderAccess") {
  static unavailableLayer(hostId: HostId, platform: typeof LanguagePlatform.Type) {
    return Layer.succeed(LanguageProviderAccess)({
      availability: (toolId, phase, trusted) =>
        Effect.suspend(() => {
          const tool = catalog.tools.find((value) => value.id === toolId);

          if (tool === undefined)
            return Effect.fail(
              new LanguageError({
                reason: "method-not-found",
                message: "Tool is not in the accepted catalog",
                retryable: false,
              })
            );

          return Effect.succeed(
            availability({
              hostId,
              platform,
              tool,
              phase,
              trusted,
              connected: true,
              approved: false,
              probes: [],
              installed: null,
              checkedAt: Date.now(),
            })
          );
        }),
      reserveLaunch: async () => {
        throw new LanguageError({
          reason: "audit-required",
          message: "Launch selection admission is unavailable",
          retryable: false,
        });
      },
      resolveLaunch: async () => {
        throw new LanguageError({
          reason: "not-installed",
          message: "Approved installed provider is unavailable",
          retryable: false,
        });
      },
    });
  }
}

export { LanguageConnectionLifetime } from "../../transport/languageConnectionLifetime.ts";

/** Supplied independently by the authenticated grant authority, not settings or checkout payloads. */
export class LanguageTrustGrantAuthority extends Context.Service<
  LanguageTrustGrantAuthority,
  {
    authorize: (
      principal: LanguageConnectionIdentity,
      scope: typeof LanguageTrustScope.Type
    ) => Effect.Effect<void, LanguageError, CurrentLanguageConnection | EventStore>;
  }
>()("polaris/languages/LanguageTrustGrantAuthority") {
  static readonly denyLayer = Layer.succeed(LanguageTrustGrantAuthority)({
    authorize: () =>
      Effect.fail(
        new LanguageError({
          reason: "awaiting-trust",
          message: "Explicit trust grant authority is unavailable",
          retryable: false,
        })
      ),
  });
}

export const languageBrokerLayer = (
  options: Omit<
    BrokerOptions,
    "discover" | "invalidateDiscovery" | "requireTrust" | "resolveLaunch" | "reserveLaunch"
  >
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const providers = yield* LanguageProviderAccess;
      const owners = yield* LanguageAcquisitionAuthority;
      const trust = yield* ExecutionTrustService;
      const provenance = yield* ProposalProvenance;
      const launch = guardedLaunchAccess(providers, owners, trust);

      return LanguageBroker.layer({
        ...options,
        prepareEdit: options.prepareEdit ?? prepareServerEdit(owners, trust, provenance),
        supportsTreeEdits: (request) => {
          try {
            return owners.authority(request).supports("languages.resources.tree-v2");
          } catch {
            return false;
          }
        },
        reserveLaunch: (request) => launch.reserveLaunch(request),
        resolveLaunch: (facts, lease, request) => launch.resolveLaunch(facts, lease, request),
      });
    })
  );
