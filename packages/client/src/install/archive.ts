/**
 * The Daemon's Release archive: a gzipped ustar of plain files, no directories
 * or links. Packaging writes it (`packArchive`); the Client reads it when it
 * downloads a build itself (`unpackArchive`); a Host extracts it with `tar -xzf`.
 */
import { gunzipSync, gzipSync } from "node:zlib";

export interface ArchiveEntry {
  readonly name: string;
  readonly mode: number;
  readonly bytes: Uint8Array;
}

const BLOCK = 512;

/** A fixed timestamp (2026-01-01) keeps archives byte-identical and avoids tar's 1970 warnings. */
const MTIME = 1_767_225_600;

const encoder = new TextEncoder();

const decoder = new TextDecoder();

const isPlainName = (name: string) =>
  name.length > 0 && name.length < 100 && !/[/\\\0]/.test(name) && name !== "." && name !== "..";

const writeString = (header: Uint8Array, offset: number, length: number, value: string) => {
  header.set(encoder.encode(value).subarray(0, length), offset);
};

const writeOctal = (header: Uint8Array, offset: number, length: number, value: number) =>
  writeString(header, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);

const checksum = (header: Uint8Array) => {
  let sum = 0;

  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i]!;

  return sum;
};

const headerFor = (entry: ArchiveEntry): Uint8Array => {
  const header = new Uint8Array(BLOCK);
  writeString(header, 0, 100, entry.name);
  writeOctal(header, 100, 8, entry.mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, entry.bytes.length);
  writeOctal(header, 136, 12, MTIME);
  header[156] = 0x30;
  writeString(header, 257, 8, "ustar\u000000");
  writeString(header, 148, 8, `${checksum(header).toString(8).padStart(6, "0")}\0 `);

  return header;
};

const padded = (size: number) => Math.ceil(size / BLOCK) * BLOCK;

/** A deterministic `.tar.gz` of `entries`, in the order given. */
export const packArchive = (entries: ReadonlyArray<ArchiveEntry>): Uint8Array => {
  const total = entries.reduce((sum, e) => sum + BLOCK + padded(e.bytes.length), 2 * BLOCK);
  const tar = new Uint8Array(total);
  let offset = 0;

  for (const entry of entries) {
    if (!isPlainName(entry.name))
      throw new Error(`archive entry name "${entry.name}" is not plain`);
    tar.set(headerFor(entry), offset);
    tar.set(entry.bytes, offset + BLOCK);
    offset += BLOCK + padded(entry.bytes.length);
  }

  return gzipSync(tar, { level: 9 });
};

const readOctal = (header: Uint8Array, offset: number, length: number) =>
  Number.parseInt(
    decoder
      .decode(header.subarray(offset, offset + length))
      .replace(/\0.*$/s, "")
      .trim() || "0",
    8
  );

const readName = (header: Uint8Array) =>
  decoder.decode(header.subarray(0, 100)).replace(/\0.*$/s, "");

/** The plain files in a `.tar.gz`; anything else (directories, links, paths) is refused. */
export const unpackArchive = (gzipped: Uint8Array): ReadonlyArray<ArchiveEntry> => {
  const tar = gunzipSync(gzipped);
  const entries: ArchiveEntry[] = [];
  let offset = 0;

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);

    if (header.every((byte) => byte === 0)) break;

    if (readOctal(header, 148, 8) !== checksum(header))
      throw new Error("archive header checksum differs");
    const name = readName(header);
    const type = header[156];

    if ((type !== 0x30 && type !== 0) || !isPlainName(name))
      throw new Error(`archive entry "${name}" is not a plain file`);
    const size = readOctal(header, 124, 12);

    if (offset + BLOCK + size > tar.length) throw new Error("archive is truncated");
    entries.push({
      name,
      mode: readOctal(header, 100, 8),
      bytes: tar.subarray(offset + BLOCK, offset + BLOCK + size),
    });
    offset += BLOCK + padded(size);
  }

  return entries;
};
