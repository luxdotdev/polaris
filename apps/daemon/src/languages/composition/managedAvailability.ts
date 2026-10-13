import { LanguageAvailability, LanguageError, LanguagePreflight } from "@polaris/protocol";
import type { LanguageEffectiveSettings } from "@polaris/protocol";
import { Effect, Predicate, Schema } from "effect";
import type { HostLanguageInstallation } from "../availability/service.ts";
import type { ObservationAdmission } from "../install/host.ts";
import type { ManagedDelivery } from "./managedDelivery.ts";
import { webTools } from "../web/index.ts";

/** Providers Polaris installs itself; they need no Trust and reuse verified receipts. */
export const managedProviderIds: readonly string[] = [
  "typescript-language-server",
  "basedpyright",
  "ruff",
  ...webTools,
  "bash-language-server",
  "sqllens-language-server",
  "rust-analyzer",
  "lua-language-server",
];

const managedProviders = new Set(managedProviderIds);

/** Discovery checks eligibility; the existing Starting launch admission owns managed downloads. */
export const providerAvailability = (
  installation: Pick<HostLanguageInstallation["Service"], "inspect">,
  managed: ManagedDelivery | undefined,
  toolId: string,
  phase: "install" | "feature",
  trusted: boolean,
  admission?: ObservationAdmission,
  settings?: typeof LanguageEffectiveSettings.Type
) => {
  if (
    !managedProviders.has(toolId) ||
    phase !== "feature" ||
    managed === undefined ||
    admission === undefined ||
    settings === undefined
  )
    return installation.inspect(
      toolId,
      phase,
      trusted || (managedProviders.has(toolId) && managed !== undefined),
      admission
    );

  return Effect.gen(function* () {
    if (settings.settings.downloadLanguageToolsAutomatically === false)
      yield* Effect.tryPromise({
        try: (signal) => managed.ensure(settings, admission, signal, toolId),
        catch: (cause) =>
          Schema.is(LanguageError)(cause)
            ? cause
            : new LanguageError({
                reason: "install-failed",
                message: "Managed language tools could not be checked",
                retryable: false,
              }),
      });

    const fact = yield* installation.inspect(toolId, "install", true, admission, {
      deferManagedNode: true,
    });

    const prerequisites = fact.prerequisites.filter((item) => item.requirement.id !== "node");

    const missing = prerequisites.filter(
      (item) => item.requirement.required && item.outcome !== "satisfied"
    );

    const preflight =
      Predicate.isTagged(fact.preflight, "Eligible") && missing.length > 0
        ? LanguagePreflight.cases.Blocked.make({
            reason: "missing-prerequisite",
            message: missing
              .map((item) => item.requirement.detail)
              .join("; ")
              .slice(0, 65536),
          })
        : fact.preflight;

    return LanguageAvailability.make({ ...fact, phase: "feature", prerequisites, preflight });
  });
};
