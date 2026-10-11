import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm, opendir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { Schema } from "effect";
import { HostId, LanguagePlatform, LanguageJsonObject } from "@polaris/protocol";
import type { ArchiveEntry } from "../catalog/packaging.ts";
import { checkAbort, digest, failure, safePath } from "./validation.ts";
import {
  descriptor,
  type ExactArtifact,
  type InstalledVersion,
  type InstallLimits,
} from "./types.ts";

import { artifactIdentity } from "./identity.ts";
import { verificationBatches } from "./verificationBatches.ts";
import { verifyStoredFile } from "./fileVerification.ts";
import {
  hasVerificationReceipt,
  versionFingerprint,
  writeVerificationReceipt,
  type VersionPaths,
} from "./verificationReceipt.ts";

const Scope = Schema.Struct({ hostId: HostId, platform: LanguagePlatform });

const FileRecord = Schema.Struct({
  path: Schema.String,
  integrity: Schema.String,
  size: Schema.Int,
  mode: Schema.Int,
});

const Receipt = Schema.Struct({
  hostId: HostId,
  platform: LanguagePlatform,
  identity: Schema.String,
  version: Schema.String,
  artifactId: Schema.String,
  integrity: Schema.String,
  descriptor: LanguageJsonObject,
  files: Schema.Array(FileRecord),
  directories: Schema.Array(Schema.String),
});

const Pointer = Schema.Struct({ identity: Schema.String });

const decodeReceipt = Schema.decodeUnknownSync(Schema.fromJsonString(Receipt));

const absent = (cause: unknown) =>
  Schema.is(Schema.Struct({ code: Schema.Literal("ENOENT") }))(cause);

const leaf = (identity: string) => {
  if (!/^sha256:[a-f0-9]{64}$/.test(identity))
    throw failure("install-failed", "Invalid storage identity");

  return identity.slice(7);
};

async function privateDirectory(path: string) {
  await mkdir(path, { mode: 0o700 }).catch(async (cause: unknown) => {
    if (!Schema.is(Schema.Struct({ code: Schema.Literal("EEXIST") }))(cause)) throw cause;
  });
  const info = await lstat(path);

  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    info.uid !== process.getuid?.()
  )
    throw failure("install-failed", "Installation directory must be private and owned");
}

async function boundedRead(path: string, maxBytes: number, expectedMode?: number) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);

  try {
    const info = await handle.stat();

    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.uid !== process.getuid?.() ||
      info.size > maxBytes
    )
      throw failure("too-large", "Stored file exceeds limit");

    if (expectedMode !== undefined && (info.mode & 0o777) !== expectedMode)
      throw failure("install-failed", "Stored file mode differs from receipt");
    const bytes = await handle.readFile();

    if (bytes.length > maxBytes) throw failure("too-large", "Stored file exceeds limit");

    return bytes;
  } finally {
    await handle.close();
  }
}

async function durableWrite(path: string, bytes: Uint8Array, mode = 0o600) {
  const handle = await open(path, "wx", mode);

  try {
    await handle.writeFile(bytes);
    await handle.chmod(mode);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function treePaths(root: string, limits: InstallLimits) {
  const files = new Set<string>();
  const directories = new Set<string>();
  const pending = [""];

  async function visit(relative: string) {
    const path = relative ? join(root, relative) : root;

    if ((await realpath(path)) !== path)
      throw failure("install-failed", "Stored tree crosses a symlink");

    for await (const entry of await opendir(path)) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;

      if (!safePath(child) || entry.isSymbolicLink())
        throw failure("install-failed", "Stored tree path is unsafe");

      if (entry.isDirectory()) directories.add(child);
      else if (entry.isFile()) files.add(child);
      else throw failure("install-failed", "Stored tree entry is unsafe");

      if (files.size + directories.size > limits.entries)
        throw failure("too-large", "Stored tree entry count exceeds limit");

      if (entry.isDirectory()) pending.push(child);
    }
  }

  for (let offset = 0; offset < pending.length;) {
    const batch = pending.slice(offset, offset + 16);
    offset += batch.length;
    const results = await Promise.allSettled(batch.map(visit));

    for (const result of results) if (result.status === "rejected") throw result.reason;
  }

  return { files, directories };
}

function entryDirectories(entries: ReadonlyArray<ArchiveEntry>) {
  const directories = new Set<string>();

  for (const entry of entries) {
    if (entry.kind === "directory") directories.add(entry.path);
    let parent = dirname(entry.path);

    while (parent !== ".") {
      directories.add(parent);
      parent = dirname(parent);
    }
  }

  return [...directories].sort();
}

async function ensureVersionCapacity(directory: string, limits: InstallLimits) {
  let count = 0;

  for await (const _entry of await opendir(join(directory, "versions"))) {
    count++;

    if (count >= limits.versions)
      throw failure("queue-full", "Retained version limit reached", true);
  }
}

async function cleanupStaging(staging: string, destination: string | null) {
  try {
    await rm(staging, { recursive: true, force: true });

    if (destination) await rm(destination, { recursive: true, force: true });
  } catch {
    throw failure(
      "recovery-required",
      "Private installer staging cleanup failed; retry requires recovery",
      true
    );
  }
}

/** Explicit private root only. No default home, global path, download, activation or execution wiring. */
export async function createVersionStorage(
  rootInput: string,
  limits: InstallLimits,
  scope: typeof Scope.Type
) {
  const root = resolve(rootInput);
  await privateDirectory(root);

  if ((await realpath(root)) !== root)
    throw failure("install-failed", "Installation root crosses a symlink");

  const scopePath = join(root, "scope.json");

  try {
    await durableWrite(scopePath, Buffer.from(JSON.stringify(scope)));
  } catch (cause) {
    if (!Schema.is(Schema.Struct({ code: Schema.Literal("EEXIST") }))(cause)) throw cause;
  }

  const recordedScope = Schema.decodeUnknownSync(Schema.fromJsonString(Scope))(
    (await boundedRead(scopePath, 4096)).toString("utf8")
  );

  if (JSON.stringify(recordedScope) !== JSON.stringify(scope))
    throw failure("conflict", "Installer root belongs to another Host or platform");

  async function toolRoot(toolId: string) {
    const path = join(root, leaf(digest(toolId)));
    await privateDirectory(path);
    await privateDirectory(join(path, "versions"));

    return path;
  }

  const verifying = new Map<string, Promise<InstalledVersion>>();

  const verified = new Map<
    string,
    { paths: VersionPaths; fingerprint: string; version: InstalledVersion }
  >();

  const verificationStats = { fullVerifications: 0, receiptReuses: 0, memoryReuses: 0 };

  async function verifyVersion(toolId: string, identity: string): Promise<InstalledVersion> {
    const path = join(await toolRoot(toolId), "versions", leaf(identity));
    const key = `${toolId}:${identity}`;
    const cached = verified.get(key);

    if (cached && (await versionFingerprint(cached.paths)) === cached.fingerprint) {
      verificationStats.memoryReuses++;

      return cached.version;
    }

    verified.delete(key);

    if ((await realpath(path)) !== path)
      throw failure("install-failed", "Stored version crosses a symlink");

    const receiptBytes = await boundedRead(join(path, "receipt.json"), limits.receiptBytes);
    const receipt = decodeReceipt(receiptBytes.toString("utf8"));

    validateFiles(receipt.files);

    if (
      receipt.identity !== identity ||
      receipt.files.length + receipt.directories.length > limits.entries
    )
      throw failure("install-failed", "Stored version receipt mismatch");
    const { tool } = descriptor(receipt.descriptor, limits.metadataBytes);
    const artifact = tool.artifacts.find((candidate) => candidate.id === receipt.artifactId);

    if (
      !artifact ||
      tool.id !== toolId ||
      tool.version !== receipt.version ||
      artifact.integrity !== receipt.integrity ||
      receipt.hostId !== scope.hostId ||
      JSON.stringify(receipt.platform) !== JSON.stringify(scope.platform) ||
      artifactIdentity({
        hostId: receipt.hostId,
        platform: receipt.platform,
        descriptor: receipt.descriptor,
        artifact,
      }) !== identity
    )
      throw failure("install-failed", "Stored version descriptor mismatch");

    if (!receipt.files.some((file) => file.path === artifact.entry))
      throw failure("install-failed", "Stored entry point missing");
    const payload = join(path, "payload");

    const paths = {
      directory: path,
      files: receipt.files.map((file) => file.path),
      directories: receipt.directories,
    };

    const fingerprint = await versionFingerprint(paths);

    const certificate = {
      format: 1,
      identity,
      receiptIntegrity: digest(receiptBytes),
      fingerprint,
    } satisfies Parameters<typeof writeVerificationReceipt>[1];

    const reused = await hasVerificationReceipt(path, certificate);

    if (reused) verificationStats.receiptReuses++;
    else {
      verificationStats.fullVerifications++;
      await verifyTree(payload, receipt);
    }

    if (
      (await versionFingerprint(paths)) !== fingerprint ||
      digest(await boundedRead(join(path, "receipt.json"), limits.receiptBytes)) !==
        certificate.receiptIntegrity
    )
      throw failure("conflict", "Stored version changed during verification", true);

    if (!reused) await writeVerificationReceipt(path, certificate);

    const version = {
      identity,
      version: receipt.version,
      artifactId: receipt.artifactId,
      integrity: receipt.integrity,
      descriptor: receipt.descriptor,
      directory: payload,
    };

    if (verified.size >= 32) verified.delete(verified.keys().next().value ?? "");
    verified.set(key, { paths, fingerprint, version });

    return version;
  }

  async function verifyTree(payload: string, receipt: typeof Receipt.Type) {
    const [treeRead, fileRead] = await Promise.allSettled([
      treePaths(payload, limits),
      verifyFiles(payload, receipt.files),
    ]);

    if (fileRead.status === "rejected") throw fileRead.reason;

    if (treeRead.status === "rejected") throw treeRead.reason;

    const tree = treeRead.value;

    if (
      tree.files.size !== receipt.files.length ||
      tree.directories.size !== receipt.directories.length ||
      receipt.files.some((file) => !tree.files.has(file.path)) ||
      receipt.directories.some((path) => !tree.directories.has(path))
    )
      throw failure("install-failed", "Stored tree differs from installation receipt");
  }

  function validateFiles(files: typeof Receipt.Type.files) {
    if (files.reduce((total, file) => total + file.size, 0) > limits.expandedBytes)
      throw failure("too-large", "Stored tree exceeds expanded limit");

    if (files.some((file) => !safePath(file.path) || file.size < 0 || file.size > limits.fileBytes))
      throw failure("install-failed", "Stored version file is unsafe");
  }

  async function verifyFiles(payload: string, files: typeof Receipt.Type.files) {
    for (const batch of verificationBatches(files)) {
      const results = await Promise.allSettled(
        batch.map(async (file) => {
          const target = join(payload, file.path);

          if ((await realpath(target)) !== target)
            throw failure("install-failed", "Stored file crosses a symlink");
          await verifyStoredFile(target, file);
        })
      );

      for (const result of results) if (result.status === "rejected") throw result.reason;
    }
  }

  async function current(toolId: string) {
    const path = join(await toolRoot(toolId), "active.json");
    let bytes: Buffer;

    try {
      bytes = await boundedRead(path, limits.metadataBytes);
    } catch (cause) {
      if (absent(cause)) return null;
      throw cause;
    }

    const pointer = Schema.decodeUnknownSync(Schema.fromJsonString(Pointer))(
      bytes.toString("utf8")
    );

    return load(toolId, pointer.identity);
  }

  async function load(toolId: string, identity: string): Promise<InstalledVersion> {
    const key = `${toolId}:${identity}`;
    let pending = verifying.get(key);

    if (pending === undefined) {
      pending = verifyVersion(toolId, identity)
        .catch((cause: unknown) => {
          verified.delete(key);
          throw cause;
        })
        .finally(() => verifying.delete(key));
      verifying.set(key, pending);
    }

    return structuredClone(await pending);
  }

  async function lock(toolId: string) {
    const path = join(await toolRoot(toolId), "install.lock");
    let handle;

    try {
      handle = await open(path, "wx", 0o600);
    } catch {
      throw failure(
        "conflict",
        "Another installer owns this tool; stale locks require recovery",
        true
      );
    }

    return async () => {
      await handle.close();
      await rm(path);
    };
  }

  async function select(toolId: string, identity: string, signal: AbortSignal) {
    const selected = await load(toolId, identity);
    const directory = await toolRoot(toolId);
    const temporary = join(directory, `.active-${crypto.randomUUID()}`);
    let selectedPointer = false;

    try {
      await durableWrite(temporary, Buffer.from(JSON.stringify(Pointer.make({ identity }))));
      checkAbort(signal);
      // Atomic pointer rename is the commit boundary. Cancellation after it cannot retract success.
      await rename(temporary, join(directory, "active.json"));
      selectedPointer = true;

      return selected;
    } finally {
      if (!selectedPointer) await rm(temporary, { force: true });
    }
  }

  async function stage(
    exact: ExactArtifact,
    entries: ReadonlyArray<ArchiveEntry>,
    signal: AbortSignal,
    beforeSelect: () => Promise<void>
  ) {
    const directory = await toolRoot(exact.tool.id);
    const staging = await mkdtemp(join(directory, ".stage-"));
    const destination = join(directory, "versions", leaf(exact.identity));
    let published = false;
    let committed = false;

    try {
      await privateDirectory(join(staging, "payload"));

      for (const entry of entries) {
        checkAbort(signal);
        const target = join(staging, "payload", entry.path);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });

        if (entry.kind === "directory") await mkdir(target, { recursive: true, mode: 0o700 });
        else await durableWrite(target, entry.bytes, entry.mode);
      }

      const receipt = Receipt.make({
        hostId: exact.hostId,
        platform: exact.platform,
        identity: exact.identity,
        version: exact.tool.version,
        artifactId: exact.artifact.id,
        integrity: exact.artifact.integrity,
        descriptor: exact.descriptor,
        directories: entryDirectories(entries),
        files: entries.flatMap((entry) =>
          entry.kind === "file"
            ? [
                FileRecord.make({
                  path: entry.path,
                  integrity: digest(entry.bytes),
                  size: entry.bytes.length,
                  mode: entry.mode,
                }),
              ]
            : []
        ),
      });

      const receiptBytes = Buffer.from(JSON.stringify(receipt));

      if (receiptBytes.length > limits.receiptBytes)
        throw failure("too-large", "Installation receipt exceeds limit");
      await durableWrite(join(staging, "receipt.json"), receiptBytes);
      await beforeSelect();
      checkAbort(signal);

      // Existing immutable directories are validated, never overwritten or treated as trusted caches.
      const existing = await lstat(destination).catch((cause: unknown) => {
        if (absent(cause)) return null;
        throw cause;
      });

      if (!existing) {
        await ensureVersionCapacity(directory, limits);
        await rename(staging, destination);
        published = true;
      }

      if (!published) await rm(staging, { recursive: true, force: true });
      const installed = await select(exact.tool.id, exact.identity, signal);
      committed = true;

      return installed;
    } finally {
      if (!committed) await cleanupStaging(staging, published ? destination : null);
    }
  }

  async function versions(toolId: string) {
    const directory = join(await toolRoot(toolId), "versions");
    const result: InstalledVersion[] = [];

    for await (const entry of await opendir(directory)) {
      if (result.length >= limits.versions)
        throw failure("too-large", "Stored version count exceeds limit");
      result.push(await load(toolId, `sha256:${entry.name}`));
    }

    return result;
  }

  async function recoveryFacts(toolId: string) {
    const directory = await toolRoot(toolId);
    const facts: string[] = [];
    let count = 0;

    for await (const entry of await opendir(directory)) {
      if (++count > limits.entries)
        throw failure("too-large", "Installation root entry count exceeds limit");

      if (
        entry.name === "install.lock" ||
        entry.name.startsWith(".stage-") ||
        entry.name.startsWith(".active-")
      )
        facts.push(entry.name);
    }

    return facts;
  }

  return {
    current,
    stage,
    lock,
    select,
    load,
    versions,
    recoveryFacts,
    stats: () => ({
      ...verificationStats,
      cachedVersions: verified.size,
      verifying: verifying.size,
    }),
  };
}

export type VersionStorage = Awaited<ReturnType<typeof createVersionStorage>>;
