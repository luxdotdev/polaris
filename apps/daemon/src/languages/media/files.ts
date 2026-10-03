import { fstatSync, read, realpathSync, statSync, type BigIntStats } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LanguageError } from "@polaris/protocol";
import { within } from "../trust/checkout.ts";
import { openPinned } from "./native.ts";
import { rasterMime } from "./raster.ts";
import type { MediaInput } from "./index.ts";

export const mediaError = (reason: LanguageError["reason"], message: string) =>
  new LanguageError({ reason, message, retryable: false });

export const checkSignal = (signal: AbortSignal) => {
  if (signal.aborted) throw mediaError("cancelled", "Media request was cancelled");
};

const sameFile = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino;

const sameVersion = (a: BigIntStats, b: BigIntStats) =>
  sameFile(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

export interface MediaPaths {
  root: string;
  document: string;
  media: string;
  lexicalMedia: string;
}

export async function resolvePaths(root: string, input: MediaInput): Promise<MediaPaths> {
  if (
    !isAbsolute(input.documentPath) ||
    !within(root, resolve(input.documentPath)) ||
    isAbsolute(input.relativePath) ||
    input.relativePath.includes("\\") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(input.relativePath)
  )
    throw mediaError("invalid-input", "Media path leaves the registered checkout");
  const document = await realpath(input.documentPath);

  if (!within(root, document))
    throw mediaError("invalid-input", "Document symlink leaves checkout");
  const lexicalMedia = resolve(dirname(document), input.relativePath);

  if (!within(root, lexicalMedia))
    throw mediaError("invalid-input", "Relative media leaves checkout");
  const media = await realpath(lexicalMedia);

  if (!within(root, media)) throw mediaError("invalid-input", "Media symlink leaves checkout");

  return { root, document, media, lexicalMedia };
}

const chunk = (fd: number, buffer: Buffer, offset: number, length: number) =>
  new Promise<number>((accept, reject) => {
    read(fd, buffer, offset, length, offset, (error, bytesRead) => {
      if (error === null) accept(bytesRead);
      else reject(error);
    });
  });

/** Buffers at most maxBytes+1 and observes growth; no readFile allocation from untrusted size. */
async function readBounded(fd: number, maxBytes: number, size: bigint, signal: AbortSignal) {
  const buffer = Buffer.alloc(Math.min(Number(size) + 1, maxBytes + 1));
  let count = 0;

  while (count < buffer.length) {
    checkSignal(signal);
    const read = await chunk(fd, buffer, count, Math.min(65536, buffer.length - count));

    if (read === 0) break;
    count += read;
  }

  checkSignal(signal);

  if (count > maxBytes) throw mediaError("too-large", "Media exceeds byte limit");

  return buffer.subarray(0, count);
}

export type MediaPhase = "resolved" | "opened" | "read";

export async function readMedia(
  paths: MediaPaths,
  input: MediaInput,
  signal: AbortSignal,
  phase: (phase: MediaPhase) => Promise<void>
) {
  const rootBefore = await stat(paths.root, { bigint: true });
  const documentBefore = await stat(paths.document, { bigint: true });
  const mediaBefore = await stat(paths.media, { bigint: true });
  await phase("resolved");
  checkSignal(signal);
  const document = openPinned(paths.root, paths.document);
  let media: ReturnType<typeof openPinned> | undefined;

  try {
    media = openPinned(paths.root, paths.media);
    const info = fstatSync(media.fd, { bigint: true });

    if (!documentBefore.isFile() || !info.isFile())
      throw mediaError("invalid-input", "Media and document must be regular files");

    if (
      !rootBefore.isDirectory() ||
      !sameFile(rootBefore, document.root) ||
      !sameFile(rootBefore, media.root) ||
      !sameVersion(documentBefore, fstatSync(document.fd, { bigint: true })) ||
      !sameVersion(mediaBefore, info)
    )
      throw mediaError("conflict", "Media filesystem identity changed");

    if (info.size > BigInt(input.maxBytes))
      throw mediaError("too-large", "Media exceeds byte limit");
    await phase("opened");
    checkSignal(signal);
    const bytes = await readBounded(media.fd, input.maxBytes, info.size, signal);
    const mimeType = rasterMime(bytes);
    await phase("read");
    await revalidate(paths, input, rootBefore, documentBefore, info);
    checkSignal(signal);

    if (!sameVersion(info, fstatSync(media.fd, { bigint: true })))
      throw mediaError("conflict", "Media changed while reading");
    const openedMedia = media;

    return {
      bytes,
      mimeType,
      uri: pathToFileURL(paths.media).href,
      close: () => {
        openedMedia.close();
        document.close();
      },
      verify: () => {
        checkSignal(signal);

        if (
          realpathSync(input.documentPath) !== paths.document ||
          realpathSync(paths.lexicalMedia) !== paths.media ||
          realpathSync(paths.root) !== paths.root ||
          !sameFile(rootBefore, statSync(paths.root, { bigint: true })) ||
          !sameVersion(documentBefore, statSync(paths.document, { bigint: true })) ||
          !sameVersion(info, statSync(paths.media, { bigint: true })) ||
          !sameVersion(info, fstatSync(openedMedia.fd, { bigint: true }))
        )
          throw mediaError("conflict", "Media changed before delivery");
      },
    };
  } catch (error) {
    media?.close();
    document.close();
    throw error;
  }
}

async function revalidate(
  paths: MediaPaths,
  input: MediaInput,
  root: BigIntStats,
  document: BigIntStats,
  media: BigIntStats
) {
  if (
    (await realpath(paths.root)) !== paths.root ||
    (await realpath(input.documentPath)) !== paths.document ||
    (await realpath(paths.lexicalMedia)) !== paths.media ||
    !sameFile(root, await stat(paths.root, { bigint: true })) ||
    !sameVersion(document, await stat(paths.document, { bigint: true })) ||
    !sameVersion(media, await stat(paths.media, { bigint: true }))
  )
    throw mediaError("conflict", "Media paths changed while reading");
}
