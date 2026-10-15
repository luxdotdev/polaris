/**
 * A resumable, verified download into a folder (ADR 0048): bytes land in `<file>.part`,
 * a restart continues with `Range`, the whole file is hashed before the atomic rename.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat, statfs } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Schema } from "effect";
import { ManagedFailureReason } from "@polaris/protocol";
import type { PinnedFile } from "./catalog.ts";

export class ManagedSetupError extends Schema.TaggedError<ManagedSetupError>()(
  "ManagedSetupError",
  { reason: ManagedFailureReason, message: Schema.String }
) {}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface DownloadOptions {
  readonly file: PinnedFile;
  readonly dir: string;
  readonly fetch: Fetcher;
  readonly signal: AbortSignal;
  readonly onProgress: (receivedBytes: number) => void;
  /** Free space on the folder's filesystem; tests supply one, the Daemon uses `freeBytes`. */
  readonly free?: (dir: string) => Promise<number | null>;
}

export const partPath = (dir: string, file: PinnedFile) => join(dir, `${file.name}.part`);

/** Free bytes on the folder's filesystem; null when it can't be read. */
/** Free space where `dir` is or would be made: the nearest existing ancestor's filesystem. */
export const freeBytes = async (dir: string): Promise<number | null> => {
  for (let path = dir; ; path = dirname(path)) {
    try {
      const fs = await statfs(path);

      return Number(fs.bavail) * Number(fs.bsize);
    } catch {
      if (dirname(path) === path) return null;
    }
  }
};

const sizeOf = async (path: string) => {
  try {
    const info = await stat(path);

    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
};

export const sha256Of = (path: string, signal?: AbortSignal) =>
  new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path, { highWaterMark: 1024 * 1024 });
    const abort = () => stream.destroy(new Error("cancelled"));
    signal?.addEventListener("abort", abort, { once: true });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", (error) => {
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
    stream.on("end", () => {
      signal?.removeEventListener("abort", abort);
      resolve(hash.digest("hex"));
    });
  });

const sameHash = (actual: string, expected: string) =>
  actual.length === expected.length &&
  timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));

/** True when the finished file is already in the folder with the pinned size and hash. */
export const isDownloaded = async (dir: string, file: PinnedFile, signal?: AbortSignal) => {
  const path = join(dir, file.name);

  if ((await sizeOf(path)) !== file.sizeBytes) return false;

  return sameHash(await sha256Of(path, signal), file.sha256);
};

const cancelled = (signal: AbortSignal) => {
  if (signal.aborted)
    throw new ManagedSetupError({ reason: "download-failed", message: "Download cancelled" });
};

const failed = (message: string) => new ManagedSetupError({ reason: "download-failed", message });

/** Needs the remaining bytes plus the part file, with 256 MB of headroom for the Host. */
export const checkSpace = async (
  dir: string,
  needed: number,
  measure: (dir: string) => Promise<number | null> = freeBytes
) => {
  const free = await measure(dir);

  if (free !== null && free < needed + 256 * 1024 ** 2)
    throw new ManagedSetupError({
      reason: "no-space",
      message: `Needs ${Math.ceil(needed / 1024 ** 3)} GB; ${(free / 1024 ** 3).toFixed(1)} GB is free`,
    });
};

const writeBody = async (
  body: ReadableStream<Uint8Array>,
  path: string,
  received: number,
  options: DownloadOptions
) => {
  const handle = await open(path, "a");
  const reader = body.getReader();
  const abort = () => void reader.cancel().catch(() => {});
  options.signal.addEventListener("abort", abort, { once: true });

  try {
    while (true) {
      cancelled(options.signal);
      const next = await reader.read();

      if (next.done) break;
      received += next.value.length;

      if (received > options.file.sizeBytes) throw failed("The file is larger than expected");
      await handle.write(next.value);
      options.onProgress(received);
    }
  } finally {
    options.signal.removeEventListener("abort", abort);
    reader.releaseLock();
    await handle.close();
  }

  return received;
};

const request = async (options: DownloadOptions, offset: number) => {
  const headers = new Headers({ "accept-encoding": "identity" });

  if (offset > 0) headers.set("range", `bytes=${offset}-`);
  let response: Response;

  try {
    response = await options.fetch(options.file.url, {
      headers,
      signal: options.signal,
      redirect: "follow",
      credentials: "omit",
    });
  } catch (error) {
    cancelled(options.signal);
    throw failed(error instanceof Error ? error.message : "The download failed");
  }

  if (offset > 0 && response.status === 200) return { response, offset: 0 };

  if (offset > 0 && response.status === 206) return { response, offset };

  if (offset === 0 && response.status === 200) return { response, offset: 0 };
  await response.body?.cancel();
  throw failed(`The publisher answered HTTP ${response.status}`);
};

/**
 * Downloads `file` into `dir`, resuming a `.part`, then verifies and renames. Throws a
 * ManagedSetupError with its reason; a bad hash removes the part so the next try is clean.
 */
export const downloadFile = async (options: DownloadOptions): Promise<void> => {
  const { file, dir, signal } = options;
  await mkdir(dir, { recursive: true }).catch(() => {
    throw new ManagedSetupError({ reason: "folder-unwritable", message: `Can't create ${dir}` });
  });

  if (await isDownloaded(dir, file, signal)) return;
  const part = partPath(dir, file);
  const have = Math.min((await sizeOf(part)) ?? 0, file.sizeBytes);
  await checkSpace(dir, file.sizeBytes - have, options.free ?? freeBytes);
  options.onProgress(have);
  cancelled(signal);
  let received = have;

  if (have < file.sizeBytes) {
    const { response, offset } = await request(options, have);

    if (offset === 0 && have > 0) await rm(part, { force: true });

    if (response.body === null) throw failed("The download had no body");
    received = await writeBody(response.body, part, offset, options);
  }

  if (received !== file.sizeBytes) throw failed("The download ended early");
  cancelled(signal);

  if (!sameHash(await sha256Of(part, signal), file.sha256)) {
    await rm(part, { force: true });
    throw new ManagedSetupError({
      reason: "checksum-mismatch",
      message: `${file.name} didn't match its published checksum`,
    });
  }

  await rename(part, join(dir, file.name));
};
