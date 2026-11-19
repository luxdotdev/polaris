/** The real macOS tools: ditto unpacks, codesign checks the seal and the signer's requirement. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { designatedRequirement, verifyMacUpdate } from "./verify.ts";

const mac = process.platform === "darwin";

let dir = "";

const zipOf = (app: string, name: string) => {
  const zip = join(dir, name);
  const made = spawnSync("/usr/bin/ditto", ["-c", "-k", "--keepParent", app, zip]);

  if (made.status !== 0) throw new Error("ditto could not archive the fixture app");

  return zip;
};

/** A minimal app signed ad hoc: its designated requirement is its own code hash. */
const appOf = (name: string, id: string) => {
  const app = join(dir, name);

  mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
  mkdirSync(join(app, "Contents/Resources"), { recursive: true });
  cpSync("/usr/bin/true", join(app, "Contents/MacOS/app"));
  writeFileSync(join(app, "Contents/Resources/notes.txt"), "as signed");
  writeFileSync(
    join(app, "Contents/Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>` +
      `<key>CFBundleIdentifier</key><string>${id}</string>` +
      `<key>CFBundleExecutable</key><string>app</string>` +
      `<key>CFBundlePackageType</key><string>APPL</string></dict></plist>`
  );
  const signed = spawnSync("/usr/bin/codesign", ["--force", "--sign", "-", app]);

  if (signed.status !== 0) throw new Error("codesign could not sign the fixture app");

  return app;
};

let SIGNED = "";

let OTHER = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "polaris-verify-"));

  if (!mac) return;
  mkdirSync(join(dir, "a"));
  mkdirSync(join(dir, "b"));
  SIGNED = appOf("a/Fixture.app", "dev.lux.polaris.fixture");
  OTHER = appOf("b/Fixture.app", "dev.lux.polaris.other");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const verify = (zip: string, bundle: string) =>
  verifyMacUpdate({ zip, scratch: join(dir, "unpacked"), bundle });

test.skipIf(!mac)("the running app's designated requirement names its signer", async () => {
  expect(await designatedRequirement(SIGNED)).toStartWith("cdhash H");
  expect(await designatedRequirement(join(dir, "Missing.app"))).toBeNull();
});

test.skipIf(!mac)(
  "an intact app from the same signer passes; another signer, a broken seal or a non-zip fail",
  async () => {
    const intact = zipOf(SIGNED, "same.zip");

    expect(await verify(intact, SIGNED)).toBe(true);
    // Validly signed, but not what the running app's requirement asks for.
    expect(await verify(intact, OTHER)).toBe(false);

    // The same app with one resource changed after signing.
    const copy = join(dir, "Fixture.app");
    cpSync(SIGNED, copy, { recursive: true, verbatimSymlinks: true });
    writeFileSync(join(copy, "Contents/Resources/notes.txt"), "changed after signing");
    expect(await verify(zipOf(copy, "tampered.zip"), SIGNED)).toBe(false);

    writeFileSync(join(dir, "garbage.zip"), "not a zip");
    expect(await verify(join(dir, "garbage.zip"), SIGNED)).toBe(false);

    // Nothing unpacked outlives a check.
    expect(readdirSync(dir)).not.toContain("unpacked");
  },
  60_000
);
