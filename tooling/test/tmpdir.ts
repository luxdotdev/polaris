/**
 * Test preload: each `bun test` run gets its own temp root, removed on exit,
 * so helpers that `mkdtempSync(tmpdir())` without cleanup can't fill /tmp.
 * Code that falls back to the real Polaris home (`~/.polaris`) gets one inside it too.
 */
import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "polaris-test-run-"));

process.env.TMPDIR = root;

// Windows' tmpdir() reads TEMP and TMP, never TMPDIR.
if (process.platform === "win32") {
  process.env.TEMP = root;
  process.env.TMP = root;
}

process.env.POLARIS_HOME ??= join(root, "polaris-home");

// A preload's afterAll runs once, after every test file.
afterAll(() => rmSync(root, { recursive: true, force: true }));
