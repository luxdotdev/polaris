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
  expect(() => packArchive([{ name: "../x", mode: 0o644, bytes: new Uint8Array() }])).toThrow();
  expect(() => packArchive([{ name: "a/b", mode: 0o644, bytes: new Uint8Array() }])).toThrow();
});

test("refuses an archive whose entry is a path or a link", () => {
  const tar = gunzipSync(packArchive([{ name: "abc", mode: 0o644, bytes: new Uint8Array(1) }]));
  const pathed = Buffer.from(tar);
  pathed.write("../", 0);
  expect(() => unpackArchive(gzipSync(pathed))).toThrow();

  const linked = Buffer.from(tar);
  linked[156] = 0x32;
  expect(() => unpackArchive(gzipSync(linked))).toThrow();
});
