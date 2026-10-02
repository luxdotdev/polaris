import {
  LanguageAvailability,
  LanguageInstallation,
  LanguagePrerequisiteFact,
  LanguagePreflight,
} from "@polaris/protocol";
import { preflight, versionSatisfies, type ProbeFact } from "../catalog/selection.ts";
import type { InstalledVersion, Progress } from "../install/types.ts";
import { descriptor, validateHost, validatePlatform, defaultLimits } from "../install/types.ts";

export interface AvailabilityInput {
  readonly hostId: LanguageAvailability["hostId"];
  readonly platform: LanguageAvailability["platform"];
  readonly tool: unknown;
  readonly connected: boolean;
  readonly trusted: boolean;
  readonly approved?: boolean;
  readonly phase: "install" | "feature";
  readonly probes: ReadonlyArray<ProbeFact>;
  readonly installed: InstalledVersion | null;
  readonly progress?: Progress;
  readonly checkedAt: number;
}

/** Demand-driven observations only: no polling, executable probes, trust grants or launch decisions. */
export function availability(input: AvailabilityInput): LanguageAvailability {
  const { tool } = descriptor(input.tool, defaultLimits.metadataBytes);
  const platform = validatePlatform(input.platform);

  const checked = preflight({
    tool,
    platform,
    probes: input.probes,
    phase: input.phase === "install" ? "install" : "features",
  });

  const prerequisites = tool.requirements.map((requirement) => {
    const probe = input.probes.find((fact) => fact.id === requirement.id);

    const outcome = !probe?.executable
      ? "missing"
      : !probe.version
        ? "unknown"
        : versionSatisfies(probe.version, requirement.version)
          ? "satisfied"
          : "incompatible";

    return LanguagePrerequisiteFact.make({
      requirement,
      effectiveExecutable: probe?.executable ?? null,
      detectedVersion: probe?.version ?? null,
      outcome,
      reason: outcome === "satisfied" ? "" : requirement.detail,
    });
  });

  const preflightFact = LanguagePreflight.cases.Eligible.make({
    artifactId: checked.artifact?.id ?? null,
  });

  const block = (
    reason: (typeof LanguagePreflight.cases.Blocked.Type)["reason"],
    message: string
  ) => LanguagePreflight.cases.Blocked.make({ reason, message: message.slice(0, 65536) });

  let blocked: typeof LanguagePreflight.cases.Blocked.Type | null = null;

  if (!input.connected) blocked = block("not-connected", "Host is unavailable");
  else if (tool.disposition !== "offered") blocked = block("not-offered", "Tool is not offered");
  else if (checked.status !== "eligible") blocked = block(checked.status, checked.reason);
  else if (input.approved !== true)
    blocked = block("audit-required", "Exact artifact approval required");
  else if (input.phase === "feature" && !input.trusted)
    blocked = block("awaiting-trust", "Workspace trust required before execution");

  let installation: typeof LanguageInstallation.Type = LanguageInstallation.cases.NotInstalled.make(
    {}
  );

  if (input.installed)
    installation = LanguageInstallation.cases.Installed.make({
      version: input.installed.version,
      artifactId: input.installed.artifactId,
      integrity: input.installed.integrity,
    });
  const progress = input.progress;

  if (progress && !["completed", "failed", "cancelled"].includes(progress.phase))
    installation = LanguageInstallation.cases.Installing.make({
      jobId: progress.jobId,
      version: progress.version,
    });
  else if (progress?.phase === "failed" || progress?.phase === "cancelled")
    installation = LanguageInstallation.cases.Failed.make({
      jobId: progress.jobId,
      version: progress.version,
      message: progress.message,
      retainedVersion: input.installed?.version ?? null,
    });

  return LanguageAvailability.make({
    hostId: validateHost(input.hostId),
    toolId: tool.id,
    pinnedVersion: tool.version,
    platform,
    phase: input.phase,
    prerequisites,
    installation,
    preflight: blocked ?? preflightFact,
    checkedAt: input.checkedAt,
    updateCandidate:
      input.installed && input.installed.version !== tool.version ? tool.version : null,
  });
}
