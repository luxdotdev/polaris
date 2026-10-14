import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { packArchive, unpackArchive } from "./archive.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "polaris-archive-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const entries = [
  { name: "polaris", mode: 0o755, bytes: new Uint8Array(1500).fill(7) },
  { name: "betterleaks", mode: 0o755, bytes: new TextEncoder().encode("#!/bin/sh\n") },
  { name: "empty", mode: 0o644, bytes: new Uint8Array(0) },
];

test("round-trips plain files with their modes", () => {
  const unpacked = unpackArchive(packArchive(entries));

  expect(unpacked.map(({ name, mode }) => ({ name, mode }))).toEqual(
    entries.map(({ name, mode }) => ({ name, mode }))
  );
  expect(unpacked.map((entry) => Buffer.from(entry.bytes))).toEqual(
    entries.map((entry) => Buffer.from(entry.bytes))
  );
});

test("is deterministic", () => {
  expect(Buffer.from(packArchive(entries))).toEqual(Buffer.from(packArchive(entries)));
});

test("the system tar extracts it, as a Host does", () => {
  const archive = join(dir, "a.tar.gz");
  writeFileSync(archive, packArchive(entries));
  const result = Bun.spawnSync(["tar", "-xzf", archive, "-C", dir]);

  expect(result.exitCode).toBe(0);
  expect(readFileSync(join(dir, "polaris"))).toEqual(Buffer.from(entries[0]!.bytes));
  expect(statSync(join(dir, "betterleaks")).mode & 0o777).toBe(0o755);
});

test("refuses names that are paths", () => {
  expect(() => packArchive([{ name: "../x", mode: 0o644, bytes: new Uint8Array() }])).toThrow(
    'archive entry name "../x" is not plain'
  );
  expect(() => packArchive([{ name: "a/b", mode: 0o644, bytes: new Uint8Array() }])).toThrow(
    'archive entry name "a/b" is not plain'
  );
});

const BLOCK = 512;

/** The ustar header checksum, as tar computes it, so a test edit can keep it valid. */
const resum = (tar: Buffer) => {
  tar.fill(0x20, 148, 156);
  const sum = tar.subarray(0, BLOCK).reduce((total, byte) => total + byte, 0);
  tar.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);

  return tar;
};

const tarOf = (name: string, size: number) =>
  Buffer.from(gunzipSync(packArchive([{ name, mode: 0o644, bytes: new Uint8Array(size) }])));

test("refuses an archive whose entry is a path or a link", () => {
  const pathed = tarOf("abc", 1);
  pathed.write("../", 0);
  expect(() => unpackArchive(gzipSync(resum(pathed)))).toThrow('archive entry "../" is not');

  const linked = tarOf("abc", 1);
  linked[156] = 0x32;
  expect(() => unpackArchive(gzipSync(resum(linked)))).toThrow('archive entry "abc" is not');
});

test("refuses a header whose checksum differs, even when the edit leaves a plain name", () => {
  const corrupt = tarOf("abc", 1);
  corrupt.write("abd", 0);

  expect(() => unpackArchive(gzipSync(corrupt))).toThrow("archive header checksum differs");
});

test("refuses an archive cut short inside an entry", () => {
  const cut = tarOf("polaris", 1500).subarray(0, BLOCK + 1000);

  expect(() => unpackArchive(gzipSync(cut))).toThrow("archive is truncated");
});
