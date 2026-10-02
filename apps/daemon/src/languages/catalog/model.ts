import { Schema } from "effect";

const Id = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/));

const Integrity = Schema.String.check(
  Schema.isPattern(/^(sha256:[a-f0-9]{64}|sha512-[A-Za-z0-9+/]{86}==)$/)
);

export const Platform = Schema.Union([
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

export type Platform = typeof Platform.Type;

export const Requirement = Schema.Struct({
  id: Id,
  scope: Schema.Literals(["server", "project", "companion", "formatter"]),
  executable: Schema.String,
  version: Schema.String,
  detail: Schema.String,
  required: Schema.Boolean,
});

export type Requirement = typeof Requirement.Type;

export const Artifact = Schema.Struct({
  id: Id,
  format: Schema.Literals(["npm", "tar.gz", "gz", "binary", "phar", "go-module"]),
  url: Schema.String,
  integrity: Integrity,
  platforms: Schema.Array(Platform),
  entry: Schema.String,
  bundle: Schema.NullOr(Schema.String),
  audit: Schema.Literals(["verified", "pending"]),
  auditReason: Schema.String,
  auditRoot: Schema.NullOr(Integrity),
});

export type Artifact = typeof Artifact.Type;

export const Tool = Schema.Struct({
  id: Id,
  disposition: Schema.Literals(["offered", "evaluation"]),
  version: Schema.String,
  source: Schema.String,
  license: Schema.String,
  artifacts: Schema.Array(Artifact),
  requirements: Schema.Array(Requirement),
  argv: Schema.Array(Schema.String),
  environment: Schema.Record(Schema.String, Schema.String),
  limitations: Schema.Array(Schema.String),
});

export type Tool = typeof Tool.Type;

export const Provider = Schema.Struct({
  id: Id,
  tool: Schema.String,
  role: Schema.Literals(["primary", "lint", "expressions"]),
  diagnostics: Schema.String,
  disableFeatures: Schema.Array(Schema.String),
  entry: Schema.NullOr(Schema.String),
  argv: Schema.Array(Schema.String),
});

export const Integration = Schema.Struct({
  id: Id,
  languageIds: Schema.Array(Schema.String),
  patterns: Schema.Array(Schema.String),
  providers: Schema.Array(Provider),
  companions: Schema.Array(Schema.String),
  formatter: Schema.Struct({
    tool: Schema.String,
    source: Schema.Literals(["managed", "developer", "configured"]),
    mode: Schema.Literals(["cli", "lsp", "configured"]),
    detail: Schema.String,
  }),
  policy: Schema.Struct({
    trust: Schema.Literal("workspace-before-execution"),
    network: Schema.Literals(["server-default", "offline-only", "no-account"]),
    configuration: Schema.String,
  }),
  limitations: Schema.Array(Schema.String),
});

export type Integration = typeof Integration.Type;

export const Catalog = Schema.Struct({
  revision: Schema.Literal(1),
  releaseDate: Schema.String,
  tools: Schema.Array(Tool),
  integrations: Schema.Array(Integration),
});

export type Catalog = typeof Catalog.Type;
