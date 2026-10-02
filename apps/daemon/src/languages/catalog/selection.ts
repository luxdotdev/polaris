import type { Artifact, Platform, Requirement, Tool } from "./model";

export interface Selection {
  readonly status: "selected" | "unsupported-platform";
  readonly artifact: Artifact | null;
  readonly reason: string;
}

export const selectArtifact = (tool: Tool, platform: Platform): Selection => {
  const artifact = tool.artifacts.find((candidate) =>
    candidate.platforms.some(
      (target) =>
        target.os === platform.os && target.arch === platform.arch && target.libc === platform.libc
    )
  );

  return artifact
    ? { status: "selected", artifact, reason: "" }
    : {
        status: "unsupported-platform",
        artifact: null,
        reason: `${tool.id} ${tool.version} has no verified artifact for ${platform.os}/${platform.arch}/${platform.libc}`,
      };
};

const components = (version: string): ReadonlyArray<number> | null => {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(version.replace(/^v/, ""));

  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : null;
};

/** Catalog requirements use >=x.y.z or nonnumeric probe requirements. Unknown versions fail closed. */
export const versionSatisfies = (detected: string, requirement: string): boolean => {
  if (requirement === "present") return detected.length > 0;

  if (!requirement.startsWith(">=")) return false;

  const actual = components(detected);
  const minimum = components(requirement.slice(2));

  if (!actual || !minimum) return false;

  for (let index = 0; index < 3; index++) {
    if (actual[index]! > minimum[index]!) return true;

    if (actual[index]! < minimum[index]!) return false;
  }

  return true;
};

export interface ProbeFact {
  readonly id: string;
  readonly executable: string | null;
  readonly version: string | null;
}

export interface PreflightInput {
  readonly tool: Tool;
  readonly platform: Platform;
  readonly probes: ReadonlyArray<ProbeFact>;
  readonly phase: "install" | "features";
}

export interface Preflight {
  readonly status: "eligible" | "unsupported-platform" | "missing-prerequisite" | "audit-required";
  readonly artifact: Artifact | null;
  readonly missing: ReadonlyArray<Requirement>;
  readonly reason: string;
}

/** Eligibility is not installed/ready: I1 must still verify, stage, retain notices and activate. */
export const preflight = ({ tool, platform, probes, phase }: PreflightInput): Preflight => {
  const selection = selectArtifact(tool, platform);

  if (!selection.artifact) return { ...selection, status: "unsupported-platform", missing: [] };

  const missing = tool.requirements.filter((requirement) => {
    if (!requirement.required || (phase === "install" && requirement.scope !== "server"))
      return false;

    const fact = probes.find((probe) => probe.id === requirement.id);

    return (
      !fact?.executable || !fact.version || !versionSatisfies(fact.version, requirement.version)
    );
  });

  if (missing.length > 0)
    return {
      status: "missing-prerequisite",
      artifact: selection.artifact,
      missing,
      reason: missing
        .map((item) => `${item.executable} ${item.version}: ${item.detail}`)
        .join("; "),
    };

  if (selection.artifact.audit === "pending")
    return {
      status: "audit-required",
      artifact: selection.artifact,
      missing: [],
      reason: selection.artifact.auditReason,
    };

  return { status: "eligible", artifact: selection.artifact, missing: [], reason: "" };
};
