/**
 * Test preload: each `bun test` run gets its own temp root, removed on exit,
 * so helpers that `mkdtempSync(tmpdir())` without cleanup can't fill /tmp.
 */
import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "polaris-test-run-"));

process.env.TMPDIR = root;

// A preload's afterAll runs once, after every test file.
afterAll(() => rmSync(root, { recursive: true, force: true }));
