import { createGunzip } from "node:zlib";
import type { ArchiveEntry } from "../catalog/packaging.ts";
import { checkAbort, failure, safePath, validateEntries } from "./validation.ts";
import { defaultLimits, type InstallLimits } from "./types.ts";

/** Bounded stream expansion; no subprocess, package scripts or filesystem extraction. */
export async function gunzip(bytes: Uint8Array, signal: AbortSignal, maxBytes: number) {
  checkAbort(signal);
  const stream = createGunzip({ chunkSize: 16 * 1024 });
  const stop = () => stream.destroy(new Error("cancelled"));
  signal.addEventListener("abort", stop, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    stream.end(bytes);

    for await (const value of stream) {
      checkAbort(signal);
      // SAFETY: node:zlib's binary stream yields Buffer chunks, never object-mode values.
      const chunk = value as Buffer;
      size += chunk.length;

      if (size > maxBytes) throw failure("too-large", "Expanded archive exceeds limit");
      chunks.push(chunk);
    }

    checkAbort(signal);

    return Buffer.concat(chunks, size);
  } finally {
    signal.removeEventListener("abort", stop);
    stream.destroy();
  }
}

function text(header: Buffer, start: number, length: number) {
  const field = header.subarray(start, start + length);
  const zero = field.indexOf(0);
  const content = zero < 0 ? field : field.subarray(0, zero);

  if (zero >= 0 && field.subarray(zero).some((byte) => byte !== 0))
    throw failure("install-failed", "Archive header contains ambiguous text");

  return new TextDecoder("utf-8", { fatal: true }).decode(content);
}

function octal(header: Buffer, start: number, length: number) {
  if (
    header
      .subarray(start, start + length)
      .some((byte) => byte !== 0 && byte !== 32 && (byte < 48 || byte > 55))
  )
    throw failure("install-failed", "Unsupported archive numeric field");

  const field = header
    .subarray(start, start + length)
    .toString("ascii")
    .replace(/[\0 ]+$/g, "")
    .trim();

  if (!/^[0-7]+$/.test(field)) throw failure("install-failed", "Unsupported archive numeric field");
  const value = Number.parseInt(field, 8);

  if (!Number.isSafeInteger(value))
    throw failure("too-large", "Archive numeric field exceeds limit");

  return value;
}

function archivePath(header: Buffer, gnu: boolean, longPath?: string) {
  const name = text(header, 0, 100);

  if (gnu && header[156] === 76 && name === "././@LongLink") return null;
  const prefix = gnu ? "" : text(header, 345, 155);
  let path = longPath ?? (prefix ? `${prefix}/${name}` : name);

  if (header[156] === 53 && path.endsWith("/")) path = path.slice(0, -1);

  if (!safePath(path)) throw failure("install-failed", "Unsafe archive path");

  return path;
}

function checkType(
  type: number | undefined,
  path: string | null,
  select?: (path: string) => boolean
) {
  if (path === null) return;
  const allowed = select === undefined || select(path) ? [0, 48, 53] : [0, 48, 53, 49, 50];

  if (type === undefined || !allowed.includes(type))
    throw failure(
      "install-failed",
      "Archive links, extensions and special entries are not permitted"
    );
}

function entry(header: Buffer, select?: (path: string) => boolean, longPath?: string) {
  let sum = 0;

  for (let index = 0; index < 512; index++)
    sum += index >= 148 && index < 156 ? 32 : header[index]!;

  if (sum !== octal(header, 148, 8))
    throw failure("install-failed", "Archive header checksum failed");
  const magic = text(header, 257, 6);
  const gnu = magic === "ustar " && header[263] === 32 && header[264] === 0;

  if (magic !== "ustar" && !(gnu && select !== undefined))
    throw failure("install-failed", "Unsupported archive header format");
  const type = header[156];
  const path = archivePath(header, gnu, longPath);
  const kind: "directory" | "file" = type === 53 ? "directory" : "file";

  checkType(type, path, select);

  return { path, kind, mode: octal(header, 100, 8), size: octal(header, 124, 12) };
}

function validateTrailer(buffer: Buffer, offset: number, longPath?: string) {
  if (longPath !== undefined) throw failure("install-failed", "Archive long name has no entry");

  if (buffer.length - offset < 1024 || buffer.subarray(offset).some((byte) => byte !== 0))
    throw failure("install-failed", "Archive trailer is incomplete or contains data");
}

function retainEntry(
  parsed: ReturnType<typeof entry>,
  bytes: Buffer,
  entries: ArchiveEntry[],
  select?: (path: string) => boolean,
  longPath?: string
) {
  if (parsed.path === null) {
    if (longPath !== undefined) throw failure("install-failed", "Duplicate archive long name");

    return text(bytes, 0, bytes.length);
  }

  if (select === undefined || select(parsed.path))
    entries.push({ ...parsed, path: parsed.path, bytes });

  return undefined;
}

/** POSIX ustar; selected Node files also accept GNU long names, without extracting links or extensions. */
export function tarEntries(
  bytes: Uint8Array,
  signal: AbortSignal,
  limits: InstallLimits = defaultLimits,
  select?: (path: string) => boolean
) {
  if (bytes.length > limits.expandedBytes + limits.entries * 1024)
    throw failure("too-large", "Archive exceeds expansion and header limits");
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: ArchiveEntry[] = [];
  let offset = 0;
  let expanded = 0;
  let count = 0;
  let longPath: string | undefined;

  while (offset + 512 <= buffer.length) {
    checkAbort(signal);
    const header = buffer.subarray(offset, offset + 512);

    if (header.every((byte) => byte === 0)) {
      validateTrailer(buffer, offset, longPath);
      validateEntries(entries, limits);

      return entries;
    }

    if (++count > limits.entries) throw failure("too-large", "Archive entry count exceeds limit");
    const parsed = entry(header, select, longPath);
    expanded += parsed.size;

    if (parsed.size > limits.fileBytes || expanded > limits.expandedBytes)
      throw failure("too-large", "Archive file or expansion exceeds limit");
    const end = offset + 512 + Math.ceil(parsed.size / 512) * 512;

    if (end > buffer.length) throw failure("install-failed", "Archive entry is truncated");

    if (buffer.subarray(offset + 512 + parsed.size, end).some((byte) => byte !== 0))
      throw failure("install-failed", "Archive padding contains data");

    longPath = retainEntry(
      parsed,
      buffer.subarray(offset + 512, offset + 512 + parsed.size),
      entries,
      select,
      longPath
    );
    offset = end;
  }

  throw failure("install-failed", "Archive trailer is missing");
}
