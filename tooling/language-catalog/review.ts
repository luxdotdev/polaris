import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { Packaging, type Tool } from "../../apps/daemon/src/languages/catalog/model";
import { isAllowed } from "../../scripts/licenses";
import { Bundle } from "./audit";
import {
  AuditManifest,
  safeArchivePath,
  verifyIntegrity,
} from "../../apps/daemon/src/languages/catalog/verification";

const Reference = Schema.Struct({ path: Schema.String, integrity: Schema.String });

const ArtifactScope = Schema.Struct({
  id: Schema.String,
  integrity: Schema.String,
  bundleIntegrity: Schema.NullOr(Schema.String),
  packaging: Schema.NullOr(Packaging),
});

export const ReviewRecord = Schema.Struct({
  tool: Schema.String,
  version: Schema.String,
  status: Schema.Literals(["policy-clear", "awaiting-review", "missing-evidence"]),
  artifacts: Schema.Array(ArtifactScope),
  evidence: Schema.Array(Reference),
  notices: Schema.Array(Reference),
  missingEvidence: Schema.Array(Schema.String),
  obligations: Schema.Array(Schema.String),
  policyScope: Schema.String,
  policyRequests: Schema.Array(
    Schema.Struct({
      package: Schema.String,
      version: Schema.String,
      license: Schema.String,
      integrity: Schema.String,
      url: Schema.String,
      notices: Schema.Array(Reference),
      decision: Schema.String,
    })
  ),
});

export type ReviewRecord = typeof ReviewRecord.Type;

export interface ReviewInput {
  readonly tools: ReadonlyArray<Tool>;
  readonly records: ReadonlyArray<ReviewRecord>;
  readonly read: (path: string) => Uint8Array;
}

const referenceFailures = (
  references: ReviewRecord["evidence"],
  read: ReviewInput["read"]
): ReadonlyArray<string> =>
  references.flatMap((reference) => {
    if (!safeArchivePath(reference.path)) return [`unsafe-reference:${reference.path}`];

    try {
      return verifyIntegrity(read(reference.path), reference.integrity)
        ? []
        : [`reference-integrity:${reference.path}`];
    } catch {
      return [`reference-missing:${reference.path}`];
    }
  });

const scopeFailures = (tool: Tool, record: ReviewRecord, read: ReviewInput["read"]): string[] => {
  const failures: string[] = [];

  if (record.version !== tool.version) failures.push(`${tool.id}:review-version`);

  if (record.artifacts.length !== tool.artifacts.length)
    failures.push(`${tool.id}:review-artifact-count`);

  for (const artifact of tool.artifacts) {
    const scope = record.artifacts.find((candidate) => candidate.id === artifact.id);

    if (!scope || scope.integrity !== artifact.integrity) {
      failures.push(`${artifact.id}:review-artifact-identity`);
      continue;
    }

    if (JSON.stringify(scope.packaging) !== JSON.stringify(artifact.packaging ?? null))
      failures.push(`${artifact.id}:review-packaging-identity`);

    if (artifact.bundle) {
      const bytes = read(`bundles/${artifact.bundle}.json`);

      if (!scope.bundleIntegrity || !verifyIntegrity(bytes, scope.bundleIntegrity))
        failures.push(`${artifact.id}:review-bundle-integrity`);

      failures.push(...policyFailures(bytes, record));
    }

    failures.push(...manifestFailures(artifact, record, read));
  }

  return failures;
};

const policyFailures = (bytes: Uint8Array, record: ReviewRecord): ReadonlyArray<string> => {
  const bundle = Schema.decodeUnknownSync(Schema.fromJsonString(Bundle))(
    Buffer.from(bytes).toString("utf8")
  );

  return bundle.packages
    .filter((pkg) => !isAllowed(pkg.license))
    .flatMap((pkg) => {
      const request = record.policyRequests.find(
        (candidate) =>
          candidate.package === pkg.name &&
          candidate.version === pkg.version &&
          candidate.license === pkg.license &&
          candidate.integrity === pkg.integrity &&
          candidate.url === pkg.url
      );

      if (!request) return [`${pkg.name}@${pkg.version}:scoped-policy-request-missing`];

      return pkg.notices.flatMap((notice) =>
        request.notices.some(
          (candidate) =>
            candidate.path === `notices/${notice.sha256}.txt` &&
            candidate.integrity === `sha256:${notice.sha256}`
        )
          ? []
          : [`${pkg.name}@${pkg.version}:scoped-policy-notice-missing`]
      );
    });
};

const manifestFailures = (
  artifact: Tool["artifacts"][number],
  record: ReviewRecord,
  read: ReviewInput["read"]
): ReadonlyArray<string> => {
  const bytes = read(`audits/${artifact.id}.json`);

  if (!artifact.auditRoot || !verifyIntegrity(bytes, artifact.auditRoot))
    return [`${artifact.id}:review-manifest-integrity`];

  const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(AuditManifest))(
    Buffer.from(bytes).toString("utf8")
  );

  const failures: string[] = [];

  if (manifest.coverage !== "complete" && record.status !== "missing-evidence")
    failures.push(`${artifact.id}:review-coverage-incomplete`);

  for (const reference of [...manifest.notices, ...(manifest.evidence ?? [])]) {
    if (reference.path === "review-records.json") continue;

    if (
      ![...record.notices, ...record.evidence].some(
        (candidate) =>
          candidate.path === reference.path && candidate.integrity === reference.integrity
      )
    )
      failures.push(`${artifact.id}:review-omission:${reference.path}`);
  }

  return failures;
};

const recordFailures = (tool: Tool, record: ReviewRecord, read: ReviewInput["read"]): string[] => {
  const failures = scopeFailures(tool, record, read);

  if (record.missingEvidence.length > 0 || record.status === "missing-evidence")
    failures.push(`${tool.id}:missing-evidence:${record.missingEvidence.join("; ")}`);

  if (record.status === "awaiting-review" && record.missingEvidence.length > 0)
    failures.push(`${tool.id}:false-awaiting-review`);

  if (!record.policyScope || record.obligations.length === 0 || record.notices.length === 0)
    failures.push(`${tool.id}:review-record-incomplete`);

  if (record.status === "policy-clear" && tool.artifacts.some((a) => a.audit !== "verified"))
    failures.push(`${tool.id}:unapproved-policy-clear`);

  return [
    ...failures,
    ...referenceFailures(record.evidence, read),
    ...referenceFailures(record.notices, read),
  ];
};

/** Pre-review is evidence readiness only; it never grants release or activation approval. */
export const reviewFailures = ({ tools, records, read }: ReviewInput): ReadonlyArray<string> => {
  const offered = tools.filter((tool) => tool.disposition === "offered");
  const failures: string[] = [];

  if (new Set(records.map((record) => record.tool)).size !== records.length)
    failures.push("duplicate-review-record");

  if (records.length !== offered.length) failures.push("review-record-count");

  for (const tool of offered) {
    const record = records.find((candidate) => candidate.tool === tool.id);

    if (!record) {
      failures.push(`${tool.id}:review-record-missing`);
      continue;
    }

    try {
      failures.push(...recordFailures(tool, record, read));
    } catch {
      failures.push(`${tool.id}:review-input-invalid`);
    }
  }

  for (const record of records)
    if (!offered.some((tool) => tool.id === record.tool))
      failures.push(`${record.tool}:non-offered-review-record`);

  return failures;
};

export const readReviewRecords = (root: string): ReadonlyArray<ReviewRecord> =>
  Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(ReviewRecord)))(
    readFileSync(join(root, "review-records.json"), "utf8")
  );

/** Bind review records back to the installer-trusted audit manifests, avoiding an unpinned side gate. */
export const reviewRootFailures = (
  tools: ReadonlyArray<Tool>,
  read: ReviewInput["read"]
): ReadonlyArray<string> =>
  tools
    .filter((tool) => tool.disposition === "offered")
    .flatMap((tool) =>
      tool.artifacts.flatMap((artifact) => {
        const bytes = read(`audits/${artifact.id}.json`);

        const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(AuditManifest))(
          Buffer.from(bytes).toString("utf8")
        );

        const reference = manifest.evidence?.find((file) => file.path === "review-records.json");

        return reference && verifyIntegrity(read(reference.path), reference.integrity)
          ? []
          : [`${artifact.id}:review-root`];
      })
    );
