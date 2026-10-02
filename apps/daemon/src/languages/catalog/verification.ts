import { createHash, timingSafeEqual } from "node:crypto";
import { Schema } from "effect";
import { posix } from "node:path";
import type { Artifact } from "./model";

/** Reject archive traversal before extraction; installers must also reject symlinks/hardlinks. */
export const safeArchivePath = (entry: string): boolean =>
  entry.length > 0 &&
  !entry.includes("\\") &&
  !entry.includes("\0") &&
  !entry.startsWith("/") &&
  !/^[a-z]:/i.test(entry) &&
  !entry.split("/").includes("..") &&
  posix.normalize(entry) !== ".";

export const verifyIntegrity = (bytes: Uint8Array, integrity: string): boolean => {
  const sha256 = /^sha256:([a-f0-9]{64})$/.exec(integrity);
  const sha512 = /^sha512-([A-Za-z0-9+/]{86}==)$/.exec(integrity);

  if (!sha256 && !sha512) return false;

  const expected = sha256 ? Buffer.from(sha256[1]!, "hex") : Buffer.from(sha512![1]!, "base64");

  const actual = createHash(sha256 ? "sha256" : "sha512")
    .update(bytes)
    .digest();

  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export interface NoticeFile {
  readonly path: string;
  readonly integrity: string;
  readonly bytes: Uint8Array;
}

export const AuditManifest = Schema.Struct({
  artifactId: Schema.String,
  artifactIntegrity: Schema.String,
  coverage: Schema.Literals(["complete", "pending"]),
  evidence: Schema.optional(
    Schema.Array(Schema.Struct({ path: Schema.String, integrity: Schema.String }))
  ),
  bundleIntegrity: Schema.optional(Schema.NullOr(Schema.String)),
  notices: Schema.Array(Schema.Struct({ path: Schema.String, integrity: Schema.String })),
});

export type AuditManifest = typeof AuditManifest.Type;

export interface AuditInput {
  readonly artifact: Artifact;
  readonly bytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
  readonly notices: ReadonlyArray<NoticeFile>;
}

const decodeManifest = Schema.decodeUnknownSync(Schema.fromJsonString(AuditManifest));

/** Notice requirements come from the pinned audit manifest, never from installer-supplied claims. */
export const auditArtifact = (input: AuditInput): ReadonlyArray<string> => {
  const failures: Array<string> = [];

  if (!verifyIntegrity(input.bytes, input.artifact.integrity)) failures.push("artifact-integrity");

  if (input.artifact.audit !== "verified")
    failures.push(`audit-pending: ${input.artifact.auditReason}`);

  if (!input.artifact.auditRoot || !verifyIntegrity(input.manifestBytes, input.artifact.auditRoot))
    return [...failures, "audit-root-integrity"];

  let manifest: AuditManifest;

  try {
    manifest = decodeManifest(Buffer.from(input.manifestBytes).toString("utf8"));
  } catch {
    return [...failures, "audit-manifest-invalid"];
  }

  if (
    manifest.artifactId !== input.artifact.id ||
    manifest.artifactIntegrity !== input.artifact.integrity
  )
    failures.push("audit-artifact-identity");

  if (manifest.coverage !== "complete" || manifest.notices.length === 0)
    failures.push("notice-coverage-incomplete");

  for (const required of manifest.notices) {
    const notice = input.notices.find((file) => file.path === required.path);

    if (
      !safeArchivePath(required.path) ||
      !notice ||
      !verifyIntegrity(notice.bytes, required.integrity)
    )
      failures.push(`notice-integrity: ${required.path}`);
  }

  return failures;
};
