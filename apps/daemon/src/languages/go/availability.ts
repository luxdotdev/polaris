import { LanguageAvailability, LanguagePreflight } from "@polaris/protocol";
import { Effect } from "effect";
import type { HostLanguageInstallation } from "../availability/service.ts";
import type { ObservationAdmission } from "../install/host.ts";

/** Nothing to install: ready is every Prerequisite present at a fixed Host location, then Trust. */
export const developerAvailability = (
  installation: Pick<HostLanguageInstallation["Service"], "inspect">,
  toolId: string,
  phase: "install" | "feature",
  trusted: boolean,
  admission?: ObservationAdmission
) =>
  Effect.map(installation.inspect(toolId, phase, trusted, admission), (fact) => {
    const missing = fact.prerequisites.filter(
      (item) => item.requirement.required && item.outcome !== "satisfied"
    );

    const preflight =
      missing.length > 0
        ? LanguagePreflight.cases.Blocked.make({
            reason: "missing-prerequisite",
            message: missing
              .map((item) => item.requirement.detail)
              .join("; ")
              .slice(0, 65536),
          })
        : phase === "feature" && !trusted
          ? LanguagePreflight.cases.Blocked.make({
              reason: "awaiting-trust",
              message: "Workspace trust required before execution",
            })
          : LanguagePreflight.cases.Eligible.make({ artifactId: null });

    return LanguageAvailability.make({ ...fact, preflight, updateCandidate: null });
  });
