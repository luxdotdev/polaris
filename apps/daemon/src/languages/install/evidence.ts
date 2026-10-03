import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Schema } from "effect";
import { AuditManifest } from "../catalog/verification.ts";
import { defaultLimits } from "./types.ts";
import { checkAbort, failure, safePath, verifyIntegrity } from "./validation.ts";
import type { EvidenceReader } from "./decode.ts";
import type { ArchiveEntry } from "../catalog/packaging.ts";

/** Explicit read-only packaged evidence root; no home lookup, download, source build or approval. */
export async function packagedEvidenceReader(rootInput: string): Promise<EvidenceReader> {
  const root = resolve(rootInput);

  if ((await realpath(root)) !== root)
    throw failure("audit-required", "Artifact evidence root crosses a symlink");

  async function read(path: string, maxBytes: number, signal: AbortSignal) {
    checkAbort(signal);

    if (!safePath(path)) throw failure("audit-required", "Artifact evidence path is unsafe");
    const target = join(root, path);

    if ((await realpath(dirname(target))) !== dirname(target))
      throw failure("audit-required", "Artifact evidence path crosses a symlink");
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);

    try {
      const before = await file.stat();

      if (!before.isFile() || before.nlink !== 1 || before.size > maxBytes)
        throw failure("audit-required", "Artifact evidence file is unsafe or oversized");
      const bytes = await file.readFile();
      const after = await file.stat();
      checkAbort(signal);

      if (bytes.length > maxBytes || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
        throw failure("audit-required", "Artifact evidence changed while reading");

      return bytes;
    } finally {
      await file.close();
    }
  }

  return async (exact, signal) => {
    const artifact = exact.artifact;

    const manifestBytes = await read(
      `audits/${artifact.id}.json`,
      defaultLimits.metadataBytes,
      signal
    );

    if (!artifact.auditRoot || !verifyIntegrity(manifestBytes, artifact.auditRoot))
      throw failure("audit-required", "Artifact audit manifest integrity failed");

    const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(AuditManifest))(
      manifestBytes.toString("utf8")
    );

    if (
      manifest.artifactId !== artifact.id ||
      manifest.artifactIntegrity !== artifact.integrity ||
      manifest.coverage !== "complete" ||
      manifest.notices.length > defaultLimits.entries
    )
      throw failure("audit-required", "Artifact audit manifest does not cover this artifact");
    const notices: ArchiveEntry[] = [];
    let total = 0;

    for (const notice of manifest.notices) {
      const bytes = await read(
        notice.path,
        Math.min(defaultLimits.fileBytes, defaultLimits.expandedBytes - total),
        signal
      );

      total += bytes.length;

      if (!verifyIntegrity(bytes, notice.integrity))
        throw failure("audit-required", "Artifact notice integrity failed");
      notices.push({ path: notice.path, kind: "file", mode: 0o644, bytes });
    }

    const packagingManifestBytes = artifact.packaging
      ? await read(artifact.packaging.manifest, defaultLimits.metadataBytes, signal)
      : undefined;

    if (
      artifact.packaging &&
      (!packagingManifestBytes ||
        !verifyIntegrity(packagingManifestBytes, artifact.packaging.manifestIntegrity))
    )
      throw failure("audit-required", "Artifact packaging manifest integrity failed");

    const evidence = { manifestBytes, notices };

    if (packagingManifestBytes) return { ...evidence, packagingManifestBytes };

    return evidence;
  };
}
