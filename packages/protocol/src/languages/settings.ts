import { Schema } from "effect";
import { HostId, ReviewCheckoutId, WorkspaceId } from "../ids.ts";
import {
  LanguageCounter,
  LanguageJsonObject,
  LanguageKey,
  LanguagePath,
  LanguageText,
  LanguageUri,
} from "./base.ts";

/** Syntax IDs match S1; documentLanguageId is separately configurable for custom servers. */

export const LanguageSyntaxId = Schema.Literals([
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "css",
  "html",
  "markdown",
  "python",
  "rust",
  "go",
  "gomod",
  "gowork",
  "yaml",
  "toml",
  "sql",
  "shell",
  "dotenv",
  "prisma",
  "java",
  "php",
  "lua",
  "c",
  "cpp",
  "csharp",
  "ruby",
  "xml",
  "dockerfile",
  "ini",
  "diff",
  "plain",
]);

export type LanguageSyntaxId = typeof LanguageSyntaxId.Type;

export const LanguageAssociation = Schema.Struct({
  language: LanguageSyntaxId,
  filenames: Schema.optionalKey(Schema.Array(LanguagePath).check(Schema.isMaxLength(256))),
  extensions: Schema.optionalKey(Schema.Array(LanguageKey).check(Schema.isMaxLength(256))),
  patterns: Schema.optionalKey(Schema.Array(LanguagePath).check(Schema.isMaxLength(256))),
});

export const LanguageSettingsScope = Schema.TaggedUnion({
  App: {},
  Language: { language: LanguageSyntaxId },
  Host: { hostId: HostId },
  Workspace: {
    hostId: HostId,
    workspaceId: WorkspaceId,
    language: Schema.NullOr(LanguageSyntaxId),
  },
});

export type LanguageSettingsScope = typeof LanguageSettingsScope.Type;

/** Environment is private configuration: never include values in logs or availability views. */

export const LanguageExecutable = Schema.Struct({
  executable: LanguagePath,
  argv: Schema.Array(LanguageText).check(Schema.isMaxLength(128)),
  environment: Schema.Record(LanguageKey, LanguageText).check(Schema.isMaxProperties(128)),
});

export const LanguageCustomServer = Schema.Struct({
  id: LanguageKey,
  launch: LanguageExecutable,
  rootMarkers: Schema.Array(LanguagePath).check(Schema.isMaxLength(64)),
  workingDirectory: Schema.NullOr(LanguagePath),
  filePatterns: Schema.Array(LanguagePath).check(Schema.isMaxLength(256)),
  documentLanguageId: LanguageKey,
  initializationOptions: LanguageJsonObject,
  settings: LanguageJsonObject,
});

export const LanguageFormatterSelection = Schema.TaggedUnion({
  None: {},
  Provider: { providerId: LanguageKey },
  Executable: {
    id: LanguageKey,
    source: Schema.Literals(["managed", "developer", "configured"]),
    launch: LanguageExecutable,
  },
});

export type LanguageFormatterSelection = typeof LanguageFormatterSelection.Type;

export const LanguageSettingsPatch = Schema.Struct({
  formatOnSave: Schema.optionalKey(Schema.Boolean),
  formatter: Schema.optionalKey(LanguageFormatterSelection),
  providers: Schema.optionalKey(Schema.Array(LanguageKey).check(Schema.isMaxLength(32))),
  associations: Schema.optionalKey(
    Schema.Array(LanguageAssociation).check(Schema.isMaxLength(512))
  ),
  customServers: Schema.optionalKey(
    Schema.Array(LanguageCustomServer).check(Schema.isMaxLength(64))
  ),
  executableOverrides: Schema.optionalKey(Schema.Record(LanguageKey, LanguageExecutable)),
  interpreter: Schema.optionalKey(Schema.NullOr(LanguagePath)),
  sdk: Schema.optionalKey(Schema.NullOr(LanguagePath)),
  pluginProbeRoots: Schema.optionalKey(Schema.Array(LanguagePath).check(Schema.isMaxLength(64))),
  serverSettings: Schema.optionalKey(Schema.Record(LanguageKey, LanguageJsonObject)),
  sql: Schema.optionalKey(
    Schema.Struct({
      dialect: Schema.Literals(["postgresql", "mysql", "sqlite", "generic"]),
      staticSchema: Schema.NullOr(LanguagePath),
      execution: Schema.Literal("disabled"),
      accountAccess: Schema.Literal("disabled"),
    })
  ),
  yamlSchemas: Schema.optionalKey(
    Schema.Array(Schema.Struct({ pattern: LanguagePath, uri: LanguageUri })).check(
      Schema.isMaxLength(128)
    )
  ),
  schemaNetwork: Schema.optionalKey(Schema.Literals(["disabled", "allowed"])),
});

export type LanguageSettingsPatch = typeof LanguageSettingsPatch.Type;

export const LanguageSettingsRecord = Schema.Struct({
  scope: LanguageSettingsScope,
  revision: LanguageCounter,
  settings: LanguageSettingsPatch,
});

export const LanguageEffectiveSettings = Schema.Struct({
  revision: LanguageCounter,
  formatOnSave: Schema.Boolean,
  formatter: LanguageFormatterSelection,
  providers: Schema.Array(LanguageKey).check(Schema.isMaxLength(32)),
  settings: LanguageSettingsPatch,
  origins: Schema.Record(LanguageKey, LanguageSettingsScope),
});

/** Worktrees inherit Workspace trust; Review Checkouts have their own explicit grant. */

export const LanguageTrustScope = Schema.TaggedUnion({
  Workspace: { hostId: HostId, workspaceId: WorkspaceId },
  ReviewCheckout: { hostId: HostId, workspaceId: WorkspaceId, reviewCheckoutId: ReviewCheckoutId },
});

export const LanguageTrust = Schema.Struct({
  scope: LanguageTrustScope,
  revision: LanguageCounter,
  trusted: Schema.Boolean,
});

export const LanguagePreviewPolicy = Schema.Struct({
  hostId: HostId,
  workspaceId: WorkspaceId,
  externalImages: Schema.Literals(["ask", "allow", "deny"]),
  scripts: Schema.Literal("disabled"),
  html: Schema.Literal("sanitized"),
  mermaid: Schema.Literal("strict"),
  maxMediaBytes: LanguageCounter.check(Schema.isBetween({ minimum: 1, maximum: 10485760 })),
});

export type LanguagePreviewPolicy = typeof LanguagePreviewPolicy.Type;

/** Client-local defaults; installation and execution still require Host preflight/trust. */
export const LANGUAGE_EDITOR_DEFAULTS = {
  formatOnSave: true,
  externalImages: "ask",
  scripts: "disabled",
  html: "sanitized",
  mermaid: "strict",
  maxMediaBytes: 10485760,
} satisfies Pick<
  LanguagePreviewPolicy,
  "externalImages" | "scripts" | "html" | "mermaid" | "maxMediaBytes"
> & { formatOnSave: boolean };
