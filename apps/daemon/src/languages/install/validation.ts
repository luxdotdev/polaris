import { createHash } from "node:crypto";
import { posix } from "node:path";
import { LanguageError } from "@polaris/protocol";
import { Schema } from "effect";
import { AuditManifest, auditArtifact, verifyIntegrity } from "../catalog/verification.ts";
import { verifyPackaging, type ArchiveEntry } from "../catalog/packaging.ts";
import type { ArtifactPayload, ExactArtifact, InstallLimits } from "./types.ts";

export const digest = (bytes: Uint8Array | string) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export const failure = (reason: LanguageError["reason"], message: string, retryable = false) =>
  new LanguageError({ reason, message: message.slice(0, 65536), retryable });

const cancellation = (signal: AbortSignal): LanguageError => {
  const cause: unknown = signal.reason;

  return Schema.is(LanguageError)(cause)
    ? cause
    : failure("cancelled", "Installation cancelled", true);
};

export const checkAbort = (signal: AbortSignal) => {
  if (signal.aborted) throw cancellation(signal);
};

export const safePath = (path: string) =>
  path.length > 0 &&
  path.normalize("NFC") === path &&
  path.length <= 4096 &&
  !path.includes("\\") &&
  !path.includes("\0") &&
  !path.startsWith("/") &&
  !/^[a-z]:/i.test(path) &&
  path.split("/").every((part) => part !== "" && part !== "." && part !== "..") &&
  posix.normalize(path) === path;

function checkEntry(entry: ArchiveEntry, limits: InstallLimits) {
  if (!safePath(entry.path)) throw failure("install-failed", "Unsafe archive path");

  if (entry.kind !== "file" && entry.kind !== "directory")
    throw failure("install-failed", "Archive links are not permitted");

  if (entry.bytes.length > limits.fileBytes)
    throw failure("too-large", "Archive file exceeds limit");

  if (entry.kind === "directory" && entry.bytes.length !== 0)
    throw failure("install-failed", "Directory contains unexpected data");

  if (entry.kind === "file" && (entry.mode & 0o400) === 0)
    throw failure("install-failed", "Archive file must be readable by its owner");

  if (!Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777)
    throw failure("install-failed", "Archive permissions are unsafe");
}

function registerPhysical(path: string, physical: Map<string, string>, limits: InstallLimits) {
  let prefix = "";

  for (const part of path.split("/")) {
    prefix = prefix ? `${prefix}/${part}` : part;
    const normalized = prefix.toLowerCase();
    const existing = physical.get(normalized);

    if (existing && existing !== prefix) throw failure("install-failed", "Archive path case alias");
    physical.set(normalized, prefix);

    if (physical.size > limits.entries)
      throw failure("too-large", "Physical archive entry count exceeds limit");
  }
}

function rejectFileParents(entries: ReadonlyArray<ArchiveEntry>, paths: Map<string, ArchiveEntry>) {
  for (const entry of entries) {
    let parent = posix.dirname(entry.path);

    while (parent !== ".") {
      const ancestor = paths.get(parent.toLowerCase());

      if (ancestor && ancestor.kind !== "directory")
        throw failure("install-failed", "Archive file collides with directory");
      parent = posix.dirname(parent);
    }
  }
}

export function validateEntries(entries: ReadonlyArray<ArchiveEntry>, limits: InstallLimits) {
  if (entries.length > limits.entries)
    throw failure("too-large", "Archive entry count exceeds limit");
  const paths = new Map<string, ArchiveEntry>();
  const physical = new Map<string, string>();
  let size = 0;

  for (const entry of entries) {
    checkEntry(entry, limits);
    registerPhysical(entry.path, physical, limits);

    const key = entry.path.toLowerCase();

    if (paths.has(key)) throw failure("install-failed", "Duplicate archive path");
    paths.set(key, entry);
    size += entry.bytes.length;

    if (size > limits.expandedBytes) throw failure("too-large", "Expanded archive exceeds limit");
  }

  rejectFileParents(entries, paths);
}

export function verifyPayload(
  bytes: Uint8Array,
  payload: ArtifactPayload,
  exact: ExactArtifact,
  limits: InstallLimits
) {
  if (payload.manifestBytes.length > limits.metadataBytes)
    throw failure("too-large", "Audit manifest exceeds limit");

  const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(AuditManifest))(
    Buffer.from(payload.manifestBytes).toString("utf8")
  );

  if (manifest.notices.length > limits.entries || (manifest.evidence?.length ?? 0) > limits.entries)
    throw failure("too-large", "Audit evidence count exceeds limit");
  const noticePaths = manifest.notices.map((notice) => notice.path.toLowerCase());

  if (new Set(noticePaths).size !== noticePaths.length)
    throw failure("audit-required", "Duplicate audit notice path");
  validateEntries(payload.entries, limits);

  const notices = payload.entries
    .filter((entry) => entry.kind === "file")
    .map((entry) => ({
      path: entry.path,
      bytes: entry.bytes,
      integrity: digest(entry.bytes),
    }));

  if (
    auditArtifact({
      artifact: exact.artifact,
      bytes,
      manifestBytes: payload.manifestBytes,
      notices,
    }).length
  )
    throw failure("audit-required", "Artifact integrity or notice audit failed");
  let installed = payload.entries;

  if (exact.artifact.packaging) {
    const manifest = payload.packagingManifestBytes;

    if (!manifest || manifest.length > limits.metadataBytes)
      throw failure("audit-required", "Packaging manifest missing or oversized");
    installed = payload.entries.filter(
      (entry) => entry.path !== "meta/3rd" && !entry.path.startsWith("meta/3rd/")
    );

    if (
      verifyPackaging({
        artifact: exact.artifact,
        sourceBytes: bytes,
        manifestBytes: manifest,
        entries: payload.entries,
        installedEntries: installed,
        thirdPartyDiscovery: payload.thirdPartyDiscovery !== false,
      }).length
    )
      throw failure("audit-required", "Packaged artifact verification failed");

    // Notices must remain present after filtering, not merely in the downloaded distribution.
    const retained = installed
      .filter((entry) => entry.kind === "file")
      .map((entry) => ({
        path: entry.path,
        bytes: entry.bytes,
        integrity: digest(entry.bytes),
      }));

    if (
      auditArtifact({
        artifact: exact.artifact,
        bytes,
        manifestBytes: payload.manifestBytes,
        notices: retained,
      }).length
    )
      throw failure("audit-required", "Filtered artifact loses required notices");
  }

  if (
    !safePath(exact.artifact.entry) ||
    !installed.some((entry) => entry.path === exact.artifact.entry && entry.kind === "file")
  )
    throw failure("install-failed", "Artifact entry point missing or unsafe");

  return installed;
}

/** Abort races only pure adapters. Late results have no access to private installation paths. */
export async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  checkAbort(signal);
  let abort = () => {};

  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(cancellation(signal));
    signal.addEventListener("abort", abort, { once: true });
  });

  try {
    return await Promise.race([promise, cancelled]);
  } catch (cause) {
    checkAbort(signal);
    throw cause;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function collect(
  source: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
  limits: InstallLimits,
  progress: (bytes: number) => void
) {
  const iterator = source[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const next = await abortable(iterator.next(), signal);

      if (next.done) break;
      size += next.value.length;

      if (size > limits.downloadBytes) throw failure("too-large", "Download exceeds limit");

      if (chunks.length >= limits.entries)
        throw failure("too-large", "Download chunk count exceeds limit");
      chunks.push(Uint8Array.from(next.value));
      progress(size);
    }

    return Buffer.concat(chunks, size);
  } finally {
    // A transport must honor abort; do not let an uncooperative iterator block own staging cleanup.
    void iterator.return?.().catch(() => {});
  }
}

export { verifyIntegrity };
