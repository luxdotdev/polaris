import { constants } from "node:fs";
import { lstat, open, realpath, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { digest, failure, safePath } from "./validation.ts";

const VerificationReceipt = Schema.Struct({
  format: Schema.Literal(1),
  identity: Schema.String,
  receiptIntegrity: Schema.String,
  fingerprint: Schema.String,
});

export interface VersionPaths {
  readonly directory: string;
  readonly files: readonly string[];
  readonly directories: readonly string[];
}

/** Metadata changes invalidate a previously verified immutable version (ADR 0032). */
export async function versionFingerprint(paths: VersionPaths) {
  const { directory } = paths;

  if ((await realpath(directory)) !== directory)
    throw failure("install-failed", "Stored version crosses a symlink");

  const entries = [
    { path: directory, directory: true, anchor: true },
    { path: join(directory, "receipt.json"), directory: false, anchor: false },
    { path: join(directory, "payload"), directory: true, anchor: false },
    ...paths.directories.map((path) => ({
      path: join(directory, "payload", path),
      directory: true,
      anchor: false,
    })),
    ...paths.files.map((path) => ({
      path: join(directory, "payload", path),
      directory: false,
      anchor: false,
    })),
  ];

  if ([...paths.files, ...paths.directories].some((path) => !safePath(path)))
    throw failure("install-failed", "Stored version path is unsafe");
  const stamps: string[] = [];

  for (let offset = 0; offset < entries.length; offset += 32) {
    const batch = await Promise.allSettled(
      entries.slice(offset, offset + 32).map(async (entry) => {
        const info = await lstat(entry.path, { bigint: true });

        if (
          info.uid !== BigInt(process.getuid?.() ?? -1) ||
          info.isSymbolicLink() ||
          (entry.directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1n) ||
          (entry.directory && (info.mode & 0o077n) !== 0n)
        )
          throw failure("install-failed", "Stored version metadata is unsafe");

        return [
          entry.path,
          info.dev,
          info.ino,
          info.uid,
          info.mode,
          ...(entry.anchor ? [] : [info.nlink, info.size, info.mtimeNs, info.ctimeNs]),
        ].join(":");
      })
    );

    for (const result of batch) {
      if (result.status === "rejected") throw result.reason;
      stamps.push(result.value);
    }
  }

  return digest(stamps.join("\n"));
}

export async function hasVerificationReceipt(
  directory: string,
  expected: typeof VerificationReceipt.Type
) {
  try {
    const handle = await open(
      join(directory, "verification.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW
    );

    try {
      const info = await handle.stat();

      if (
        !info.isFile() ||
        info.nlink !== 1 ||
        info.uid !== process.getuid?.() ||
        (info.mode & 0o777) !== 0o600 ||
        info.size > 4096
      )
        return false;
      const bytes = await handle.readFile();

      if (bytes.length > 4096) return false;

      const stored = Schema.decodeUnknownSync(Schema.fromJsonString(VerificationReceipt))(
        bytes.toString("utf8")
      );

      return (
        stored.identity === expected.identity &&
        stored.receiptIntegrity === expected.receiptIntegrity &&
        stored.fingerprint === expected.fingerprint
      );
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

export async function writeVerificationReceipt(
  directory: string,
  receipt: typeof VerificationReceipt.Type
) {
  const temporary = join(directory, `.verification-${crypto.randomUUID()}`);
  const handle = await open(temporary, "wx", 0o600);

  try {
    try {
      await handle.writeFile(JSON.stringify(VerificationReceipt.make(receipt)));
      await handle.sync();
    } finally {
      await handle.close();
    }

    await rename(temporary, join(directory, "verification.json"));
  } finally {
    await rm(temporary, { force: true });
  }
}
