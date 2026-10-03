import { Schema } from "effect";
import { HostId } from "../ids.ts";
import {
  LanguageCounter,
  LanguageFingerprint,
  LanguageKey,
  LanguageEnvironment,
  LanguageEnvironmentName,
  LanguagePath,
  LanguageRelativePath,
  LanguageText,
} from "./base.ts";

export const LanguagePlatform = Schema.Union([
  Schema.Struct({
    os: Schema.Literal("darwin"),
    arch: Schema.Literals(["arm64", "x64"]),
    libc: Schema.Literal("none"),
  }),
  Schema.Struct({
    os: Schema.Literal("linux"),
    arch: Schema.Literals(["arm64", "x64"]),
    libc: Schema.Literals(["glibc", "musl"]),
  }),
]);

export const LanguageIntegrity = Schema.String.check(
  Schema.isPattern(/^(sha256:[a-f0-9]{64}|sha512-[A-Za-z0-9+/]{86}==)$/)
);

export const LanguageRequirement = Schema.Struct({
  id: LanguageKey,
  scope: Schema.Literals(["server", "project", "companion", "formatter"]),
  executable: LanguagePath,
  version: LanguageText,
  detail: LanguageText,
  required: Schema.Boolean,
});

export const LanguageArtifactPackaging = Schema.Struct({
  filter: Schema.Literal("lua-core-v1"),
  sourceIntegrity: LanguageIntegrity,
  manifest: LanguageRelativePath,
  manifestIntegrity: LanguageIntegrity,
  postFilterIntegrity: LanguageIntegrity,
  disableThirdPartyDiscovery: Schema.Literal(true),
});

export const LanguageArtifact = Schema.Struct({
  id: LanguageKey,
  format: Schema.Literals(["npm", "tar.gz", "gz", "binary", "phar", "go-module"]),
  url: LanguageText,
  integrity: LanguageIntegrity,
  platforms: Schema.Array(LanguagePlatform).check(Schema.isMaxLength(32)),
  entry: LanguagePath,
  bundle: Schema.NullOr(LanguagePath),
  audit: Schema.Literals(["verified", "pending"]),
  auditReason: LanguageText,
  auditRoot: Schema.NullOr(LanguageIntegrity),
  packaging: Schema.optionalKey(LanguageArtifactPackaging),
});

export const LanguageTool = Schema.Struct({
  id: LanguageKey,
  disposition: Schema.Literals(["offered", "evaluation"]),
  version: LanguageText,
  source: LanguageText,
  license: LanguageText,
  artifacts: Schema.Array(LanguageArtifact).check(Schema.isMaxLength(32)),
  requirements: Schema.Array(LanguageRequirement).check(Schema.isMaxLength(64)),
  argv: Schema.Array(LanguageText).check(Schema.isMaxLength(128)),
  environment: LanguageEnvironment,
  limitations: Schema.Array(LanguageText).check(Schema.isMaxLength(128)),
});

export type LanguageTool = typeof LanguageTool.Type;

export const LanguageProviderDescriptor = Schema.Struct({
  id: LanguageKey,
  tool: LanguageKey,
  role: Schema.Literals(["primary", "lint", "expressions"]),
  diagnostics: LanguageText,
  disableFeatures: Schema.Array(LanguageText).check(Schema.isMaxLength(128)),
  entry: Schema.NullOr(LanguagePath),
  argv: Schema.Array(LanguageText).check(Schema.isMaxLength(128)),
});

export const LanguageDeveloperCompanion = Schema.Struct({
  id: LanguageKey,
  executable: LanguagePath,
  version: LanguageText,
  provider: LanguageKey,
  capability: LanguageKey,
  setting: LanguageKey,
  source: Schema.Literal("developer"),
  missingDetail: LanguageText,
});

export const LanguageIntegrationDescriptor = Schema.Struct({
  id: LanguageKey,
  languageIds: Schema.Array(LanguageKey).check(Schema.isMaxLength(64)),
  patterns: Schema.Array(LanguagePath).check(Schema.isMaxLength(256)),
  providers: Schema.Array(LanguageProviderDescriptor).check(Schema.isMaxLength(32)),
  companions: Schema.Array(LanguageKey).check(Schema.isMaxLength(32)),
  developerCompanions: Schema.optionalKey(
    Schema.Array(LanguageDeveloperCompanion).check(Schema.isMaxLength(32))
  ),
  formatter: Schema.Struct({
    tool: LanguageKey,
    source: Schema.Literals(["managed", "developer", "configured"]),
    mode: Schema.Literals(["cli", "lsp", "configured"]),
    detail: LanguageText,
  }),
  policy: Schema.Struct({
    trust: Schema.Literal("workspace-before-execution"),
    network: Schema.Literals(["server-default", "offline-only", "no-account"]),
    configuration: LanguageText,
  }),
  limitations: Schema.Array(LanguageText).check(Schema.isMaxLength(128)),
});

export const LanguageCatalog = Schema.Struct({
  revision: Schema.Literal(1),
  releaseDate: LanguageText,
  tools: Schema.Array(LanguageTool).check(Schema.isMaxLength(512)),
  integrations: Schema.Array(LanguageIntegrationDescriptor).check(Schema.isMaxLength(256)),
});

export type LanguageCatalog = typeof LanguageCatalog.Type;

export const LanguagePrerequisiteFact = Schema.Struct({
  requirement: LanguageRequirement,
  effectiveExecutable: Schema.NullOr(LanguagePath),
  detectedVersion: Schema.NullOr(LanguageText),
  outcome: Schema.Literals(["satisfied", "missing", "incompatible", "unknown"]),
  reason: LanguageText,
});

export const LanguagePreflight = Schema.TaggedUnion({
  Eligible: { artifactId: Schema.NullOr(LanguageKey) },
  Blocked: {
    reason: Schema.Literals([
      "not-offered",
      "audit-required",
      "unsupported-platform",
      "missing-prerequisite",
      "awaiting-trust",
      "not-connected",
    ]),
    message: LanguageText,
  },
});

export const LanguageInstallation = Schema.TaggedUnion({
  NotInstalled: {},
  Installing: { jobId: LanguageKey, version: LanguageText },
  Installed: { version: LanguageText, artifactId: LanguageKey, integrity: LanguageIntegrity },
  Failed: {
    jobId: LanguageKey,
    version: LanguageText,
    message: LanguageText,
    retainedVersion: Schema.NullOr(LanguageText),
  },
});

export const LanguageAvailability = Schema.Struct({
  hostId: HostId,
  toolId: LanguageKey,
  pinnedVersion: LanguageText,
  platform: LanguagePlatform,
  installation: LanguageInstallation,
  updateCandidate: Schema.NullOr(LanguageText),
  phase: Schema.Literals(["install", "feature"]),
  prerequisites: Schema.Array(LanguagePrerequisiteFact).check(Schema.isMaxLength(64)),
  preflight: LanguagePreflight,
  checkedAt: LanguageCounter,
});

export type LanguageAvailability = typeof LanguageAvailability.Type;

export const LanguageInstallProgress = Schema.Struct({
  hostId: HostId,
  toolId: LanguageKey,
  version: LanguageText,
  jobId: LanguageKey,
  sequence: LanguageCounter,
  phase: Schema.Literals([
    "queued",
    "preflight",
    "downloading",
    "verifying",
    "staging",
    "activating",
    "completed",
    "failed",
    "cancelled",
  ]),
  downloadedBytes: LanguageCounter,
  totalBytes: Schema.NullOr(LanguageCounter),
  message: LanguageText,
  activeVersion: Schema.NullOr(LanguageText),
});

export type LanguageInstallProgress = typeof LanguageInstallProgress.Type;

/** Offered eligibility is mandatory even if the catalog's artifact preflight returns eligible. */

export const languageToolOffered = (tool: LanguageTool): boolean => tool.disposition === "offered";

export const LanguageLaunchFact = Schema.Struct({
  providerId: LanguageKey,
  executable: LanguagePath,
  argv: Schema.Array(LanguageText).check(Schema.isMaxLength(128)),
  workingDirectory: LanguagePath,
  environmentKeys: Schema.Array(LanguageEnvironmentName).check(Schema.isMaxLength(128)),
  sdk: Schema.NullOr(LanguagePath),
  interpreter: Schema.NullOr(LanguagePath),
  pluginProbeRoots: Schema.Array(LanguagePath).check(Schema.isMaxLength(64)),
  configurationFingerprint: LanguageFingerprint,
});
