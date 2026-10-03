import { constants } from "node:fs";
import { open, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { sameVersion } from "../../files/version.ts";
import { resourceIdentity, sameIdentity, ancestors } from "../../files/edits/trees/snapshot.ts";
import type { LanguageTreeManifest } from "@polaris/protocol";
import { preparationLimits } from "./contracts.ts";

/** Pin the expected no-follow inode before reading bounded text; version.ts's unconstrained pathname read is unsafe here. */
export const readText = async (root: string, path: string, tree: LanguageTreeManifest | null) => {
  if (tree === null) return null;
  const entry = tree.entries[0]!;

  if (
    entry.kind !== "file" ||
    entry.version === null ||
    entry.version.size > preparationLimits.fileBytes
  )
    throw new Error("Text snapshot is not a bounded regular file.");
  const parents = await ancestors(root, path);
  const before = await lstat(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);

  try {
    const pinned = await handle.stat();

    if (
      !sameIdentity(entry.identity, resourceIdentity(pinned)) ||
      pinned.size !== entry.version.size ||
      pinned.ctimeMs !== before.ctimeMs
    )
      throw new Error("Text file replaced before bounded read.");
    const bytes = Buffer.alloc(entry.version.size + 1);
    let size = 0;

    while (size < bytes.length) {
      const result = await handle.read(bytes, size, bytes.length - size, size);

      if (result.bytesRead === 0) break;
      size += result.bytesRead;
    }

    const after = await handle.stat();

    const version = {
      mtimeMs: after.mtimeMs,
      size,
      hash: createHash("sha256").update(bytes.subarray(0, size)).digest("hex"),
    };

    if (
      !sameVersion(version, entry.version) ||
      after.ctimeMs !== before.ctimeMs ||
      !sameIdentity(entry.identity, resourceIdentity(await lstat(path)))
    )
      throw new Error("Text file changed during snapshot.");

    for (const parent of parents) {
      if (!sameIdentity(parent.identity, resourceIdentity(await lstat(parent.path))))
        throw new Error("Text snapshot parent replaced.");
    }

    const value = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes.subarray(0, size)
    );

    if (value.includes("\u0000")) throw new Error("Binary text snapshot is unsupported.");

    return value;
  } finally {
    await handle.close();
  }
};
