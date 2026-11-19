/** The real macOS tools: ditto unpacks, codesign checks the seal and the signer's requirement. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { crc32 } from "node:zlib";
import { join } from "node:path";
import { designatedRequirement, MAX_UNPACKED_BYTES, verifyMacUpdate } from "./verify.ts";

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

const verify = (zip: string, bundle: string, maxUnpackedBytes = MAX_UNPACKED_BYTES) =>
  verifyMacUpdate({ zip, scratch: join(dir, "unpacked"), bundle, maxUnpackedBytes });

interface Entry {
  readonly name: string;
  readonly data: string;
  /** A symlink whose target is `data`. */
  readonly link?: boolean;
}

const u16 = (value: number) => [value & 0xff, value >>> 8];

const u32 = (value: number) => [...u16(value & 0xffff), ...u16(value >>> 16)];

/** A stored (uncompressed) zip written by hand, so its entry names can be hostile. */
const zipWith = (name: string, entries: ReadonlyArray<Entry>) => {
  const local: Array<number> = [];
  const central: Array<number> = [];

  for (const entry of entries) {
    const file = [...Buffer.from(entry.name)];
    const data = Buffer.from(entry.data);
    const sizes = [...u32(crc32(data)), ...u32(data.length), ...u32(data.length)];
    const head = [...u16(0), ...u16(0), ...u16(0), ...u16(0), ...sizes, ...u16(file.length)];
    const mode = (entry.link === true ? 0o120777 : 0o100644) * 0x10000;

    central.push(0x50, 0x4b, 1, 2, ...u16(0x031e), ...u16(20), ...head, ...u16(0), ...u16(0));
    central.push(...u16(0), ...u16(0), ...u32(mode), ...u32(local.length), ...file);
    local.push(0x50, 0x4b, 3, 4, ...u16(20), ...head, ...u16(0), ...file, ...data);
  }

  const end = [0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(entries.length)];

  end.push(...u16(entries.length), ...u32(central.length), ...u32(local.length), ...u16(0));
  writeFileSync(join(dir, name), Uint8Array.from([...local, ...central, ...end]));

  return join(dir, name);
};

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

test.skipIf(!mac)(
  "entries that climb out of the folder, absolute ones and symlinks leave nothing outside it",
  async () => {
    const outside = join(dir, "outside");

    mkdirSync(outside);
    mkdirSync(join(dir, "nest/inner"), { recursive: true });

    // ditto itself, on a zip from the same writer: the climbing entry lands inside the folder.
    const control = zipWith("control.zip", [
      { name: "kept.txt", data: "x" },
      { name: "../climbed.txt", data: "x" },
    ]);

    expect(spawnSync("/usr/bin/ditto", ["-x", "-k", control, join(dir, "nest/inner")]).status).toBe(
      0
    );
    expect(readdirSync(join(dir, "nest/inner")).toSorted()).toEqual(["climbed.txt", "kept.txt"]);
    expect(readdirSync(join(dir, "nest"))).toEqual(["inner"]);
    const before = readdirSync(dir).toSorted();

    const hostile = zipWith("slip.zip", [
      { name: "../climbed.txt", data: "x" },
      { name: "../../climbed-twice.txt", data: "x" },
      { name: join(outside, "absolute.txt"), data: "x" },
      { name: "door", data: outside, link: true },
      { name: "door/through-a-link.txt", data: "x" },
    ]);

    expect(await verify(hostile, SIGNED)).toBe(false);
    expect(readdirSync(outside)).toEqual([]);
    expect(readdirSync(dir).toSorted()).toEqual([...before, "slip.zip"].toSorted());
    expect(readdirSync(join(dir, ".."))).not.toContain("climbed-twice.txt");
  },
  60_000
);

test.skipIf(!mac)(
  "an Update that unpacks past the disk budget is refused, however small its zip says it is",
  async () => {
    const intact = zipOf(SIGNED, "budget.zip");

    expect(await verify(intact, SIGNED, 16 * 1024)).toBe(false);
    expect(await verify(intact, SIGNED, 64 * 1024 * 1024)).toBe(true);
    expect(readdirSync(dir)).not.toContain("unpacked");
  },
  60_000
);
