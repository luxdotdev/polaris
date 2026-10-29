/**
 * Renders the Live Activity's views to PNGs in both themes, on a booted simulator, for review
 * without a lock screen: `bun scripts/liveRender.ts <simulator udid> <out dir>`.
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [udid, out] = Bun.argv.slice(2);

if (udid === undefined || out === undefined)
  throw new Error("usage: bun scripts/liveRender.ts <simulator udid> <out dir>");

const widgets = join(import.meta.dir, "../targets/widgets");

const sources = [
  "Theme.swift",
  "Snapshot.swift",
  "LiveAttributes.swift",
  "LiveSlices.swift",
  "LiveCelestials.swift",
  "LiveViews.swift",
  "LiveIntents.swift",
].map((file) => join(widgets, file));

const binary = join(mkdtempSync(join(tmpdir(), "polaris-live-")), "live");

const run = (command: ReadonlyArray<string>) => {
  const done = Bun.spawnSync([...command], { stdout: "inherit", stderr: "inherit" });

  if (done.exitCode !== 0) throw new Error(`${command[0]} exited ${done.exitCode}`);
};

run([
  "xcrun",
  "--sdk",
  "iphonesimulator",
  "swiftc",
  "-target",
  "arm64-apple-ios17.0-simulator",
  "-o",
  binary,
  ...sources,
  join(import.meta.dir, "liveDriver/main.swift"),
]);

mkdirSync(out, { recursive: true });

run(["xcrun", "simctl", "spawn", udid, binary, out]);
