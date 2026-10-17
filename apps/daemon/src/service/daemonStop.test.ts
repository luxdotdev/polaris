import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { takeStopRecord, writeStopRecord } from "./daemonStop.ts";

const dirs: Array<string> = [];

const home = () => {
  const dir = mkdtempSync(join(tmpdir(), "polaris-stop-"));
  dirs.push(dir);

  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("the next Daemon reads why the last one stopped, and a restart after it doesn't repeat it", () => {
  const root = home();
  writeStopRecord(root, "upgrade", "0.2.0");

  expect(takeStopRecord(root)).toMatchObject({ reason: "upgrade", fromVersion: "0.2.0" });
  expect(takeStopRecord(root)).toBeNull();
});

test("a damaged record is dropped rather than failing the Daemon's start", () => {
  const root = home();
  writeFileSync(join(root, "daemon-stop.json"), "{");

  expect(takeStopRecord(root)).toBeNull();
  expect(takeStopRecord(root)).toBeNull();
});
