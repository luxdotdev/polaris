import { createHash, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { failure } from "./validation.ts";

interface StoredFile {
  readonly size: number;
  readonly mode: number;
  readonly integrity: string;
}

/** Verify complete stored bytes with bounded buffers and an asynchronous read between hash chunks. */
export async function verifyStoredFile(path: string, expected: StoredFile) {
  const sha256 = /^sha256:([a-f0-9]{64})$/.exec(expected.integrity);
  const sha512 = /^sha512-([A-Za-z0-9+/]{86}==)$/.exec(expected.integrity);

  if (!sha256 && !sha512) throw failure("install-failed", "Stored version integrity failed");
  const expectedHash = Buffer.from(sha256?.[1] ?? sha512?.[1] ?? "", sha256 ? "hex" : "base64");
  const hash = createHash(sha256 ? "sha256" : "sha512");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);

  try {
    const info = await handle.stat();

    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.uid !== process.getuid?.() ||
      info.size > expected.size
    )
      throw failure("too-large", "Stored file exceeds limit");

    if ((info.mode & 0o777) !== expected.mode)
      throw failure("install-failed", "Stored file mode differs from receipt");
    const buffer = Buffer.allocUnsafe(Math.min(expected.size + 1, 1024 * 1024));
    let total = 0;

    while (true) {
      const length = Math.min(buffer.length, expected.size - total + 1);
      const { bytesRead } = await handle.read(buffer, 0, length, null);

      if (!bytesRead) break;
      total += bytesRead;

      if (total > expected.size) throw failure("too-large", "Stored file exceeds limit");
      hash.update(buffer.subarray(0, bytesRead));
    }

    const actual = hash.digest();

    if (
      total !== expected.size ||
      expectedHash.length !== actual.length ||
      !timingSafeEqual(expectedHash, actual)
    )
      throw failure("install-failed", "Stored version integrity failed");
  } finally {
    await handle.close();
  }
}
