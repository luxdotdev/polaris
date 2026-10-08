import { open } from "node:fs/promises";

/**
 * A regular file's text, or null when it's missing, not a regular file (a FIFO, `/dev/zero`) or
 * larger than `maxBytes`; the checkout is untrusted, so reads are bounded by what they read.
 */
export async function readCapped(path: string, maxBytes: number): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(path, "r");
    const info = await handle.stat();

    if (!info.isFile() || info.size > maxBytes) return null;
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0);

    return bytesRead > maxBytes ? null : buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}
