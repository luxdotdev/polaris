import type { ArchiveEntry } from "../catalog/packaging.ts";
import { gunzip, tarEntries } from "./archive.ts";
import { checkAbort, failure, validateEntries, verifyIntegrity } from "./validation.ts";
import { defaultLimits, type ExactArtifact, type ArtifactPayload } from "./types.ts";

export interface ArtifactEvidence {
  readonly manifestBytes: Uint8Array;
  readonly notices: ReadonlyArray<ArchiveEntry>;
  readonly packagingManifestBytes?: Uint8Array;
}

export type EvidenceReader = (
  exact: ExactArtifact,
  signal: AbortSignal
) => Promise<ArtifactEvidence>;

function mergeNotices(entries: ReadonlyArray<ArchiveEntry>, evidence: ArtifactEvidence) {
  validateEntries(evidence.notices, defaultLimits);
  const merged = [...entries];

  for (const notice of evidence.notices) {
    const existing = entries.find((entry) => entry.path === notice.path);

    if (!existing) merged.push(notice);
    else if (
      existing.kind !== "file" ||
      !Buffer.from(existing.bytes).equals(Buffer.from(notice.bytes))
    )
      throw failure("audit-required", "Archive notice differs from pinned evidence");
  }

  validateEntries(merged, defaultLimits);

  return merged;
}

/** Evidence reader must bound allocation. Core checks pinned manifest/notices/packaging again before storage. */
export function artifactDecoder(readEvidence: EvidenceReader) {
  return async (
    bytes: Uint8Array,
    exact: ExactArtifact,
    signal: AbortSignal
  ): Promise<ArtifactPayload> => {
    checkAbort(signal);

    if (
      bytes.length > defaultLimits.downloadBytes ||
      !verifyIntegrity(bytes, exact.artifact.integrity)
    )
      throw failure("audit-required", "Artifact integrity failed before decoding");
    const artifact = exact.artifact;
    let entries: ReadonlyArray<ArchiveEntry>;

    if (artifact.bundle !== null || artifact.format === "go-module")
      throw failure("audit-required", "Artifact requires a verified prebuilt bundle adapter");

    if (artifact.format === "tar.gz" || artifact.format === "npm") {
      const archive = await gunzip(
        bytes,
        signal,
        defaultLimits.expandedBytes + defaultLimits.entries * 1024
      );

      entries = tarEntries(archive, signal);
    } else {
      const content =
        artifact.format === "gz" ? await gunzip(bytes, signal, defaultLimits.fileBytes) : bytes;

      entries = [
        {
          path: artifact.entry,
          kind: "file",
          mode: artifact.format === "phar" ? 0o644 : 0o755,
          bytes: content,
        },
      ];
    }

    const evidence = await readEvidence(structuredClone(exact), signal);
    checkAbort(signal);

    if (
      evidence.manifestBytes.length > defaultLimits.metadataBytes ||
      (evidence.packagingManifestBytes?.length ?? 0) > defaultLimits.metadataBytes
    )
      throw failure("too-large", "Artifact evidence exceeds limit");

    const payload = {
      manifestBytes: Uint8Array.from(evidence.manifestBytes),
      entries: mergeNotices(entries, evidence),
      thirdPartyDiscovery: !artifact.packaging,
    };

    if (evidence.packagingManifestBytes)
      return {
        ...payload,
        packagingManifestBytes: Uint8Array.from(evidence.packagingManifestBytes),
      };

    return payload;
  };
}
