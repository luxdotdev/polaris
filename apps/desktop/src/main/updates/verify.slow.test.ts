/** The real macOS tools: ditto unpacks, codesign checks the seal and the signer's requirement. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { crc32, deflateRawSync } from "node:zlib";
import { join } from "node:path";
import {
  designatedRequirement,
  MAX_UNPACKED_BYTES,
  runTool,
  verifyMacUpdate,
  type Run,
} from "./verify.ts";

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
  /** Deflated zeros that unpack to this many bytes, listed as ten: `data` is ignored. */
  readonly zeros?: number;
}

const u16 = (value: number) => [value & 0xff, value >>> 8];

const u32 = (value: number) => [...u16(value & 0xffff), ...u16(value >>> 16)];

/** A stored (uncompressed) zip written by hand, so its entry names can be hostile. */
const zipWith = (name: string, entries: ReadonlyArray<Entry>) => {
  const local: Array<number> = [];
  const central: Array<number> = [];

  for (const entry of entries) {
    const file = [...Buffer.from(entry.name)];
    const plain = entry.zeros === undefined ? Buffer.from(entry.data) : Buffer.alloc(entry.zeros);
    const data = entry.zeros === undefined ? plain : deflateRawSync(plain);
    const stated = entry.zeros === undefined ? plain.length : 10;
    const sizes = [...u32(crc32(plain)), ...u32(data.length), ...u32(stated)];
    const method = entry.zeros === undefined ? 0 : 8;
    const head = [...u16(0), ...u16(method), ...u16(0), ...u16(0), ...sizes, ...u16(file.length)];
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

/** The real tools, with the names of those that ran; `broken` ones return nothing. */
const recorded = (broken: ReadonlyArray<string> = []) => {
  const ran: Array<string> = [];

  const run: Run = (file, args, stop) => {
    const tool = file.split("/").at(-1) ?? "";

    ran.push(tool);

    return broken.includes(tool)
      ? Promise.resolve({ code: null, stdout: "" })
      : runTool(file, args, stop);
  };

  return { ran, run };
};

const budgeted = (zip: string, maxUnpackedBytes: number, run: Run) =>
  verifyMacUpdate({ zip, scratch: join(dir, "unpacked"), bundle: SIGNED, maxUnpackedBytes, run });

test.skipIf(!mac)(
  "a zip listing more than the disk budget is refused before it is unpacked",
  async () => {
    const intact = zipOf(SIGNED, "budget.zip");
    const small = recorded();

    expect(await budgeted(intact, 16 * 1024, small.run)).toBe(false);
    expect(small.ran).not.toContain("ditto");
    expect(await budgeted(intact, 64 * 1024 ** 2, recorded().run)).toBe(true);
  },
  60_000
);

test.skipIf(!mac)(
  "a zip that lists ten bytes and unpacks twenty megabytes is refused by what lands on disk",
  async () => {
    const lying = zipWith("lying.zip", [{ name: "Big.app", data: "", zeros: 20 * 1024 ** 2 }]);
    const tools = recorded();

    // One entry named like an app, so only the budget stands between it and codesign.
    expect(await budgeted(lying, 1024 ** 2, tools.run)).toBe(false);
    expect(tools.ran).toContain("ditto");
    expect(tools.ran.filter((tool) => tool === "codesign")).toHaveLength(1);

    // With room for it the same zip unpacks and reaches the signature check, which refuses it.
    const roomy = recorded();

    expect(await budgeted(lying, 1024 ** 3, roomy.run)).toBe(false);
    expect(roomy.ran.filter((tool) => tool === "codesign")).toHaveLength(2);
    expect(readdirSync(dir)).not.toContain("unpacked");
  },
  60_000
);

test.skipIf(!mac)(
  "an unpacking folder that can't be measured, or a zip that can't be listed, is refused",
  async () => {
    const intact = zipOf(SIGNED, "unmeasured.zip");

    expect(await budgeted(intact, MAX_UNPACKED_BYTES, recorded(["du"]).run)).toBe(false);

    // A scan that skipped a subtree prints a total and exits non-zero: that is not a measurement.
    const partial: Run = async (file, args, stop) => {
      const ran = await runTool(file, args, stop);

      return file.endsWith("/du") ? { ...ran, code: 1 } : ran;
    };

    expect(await budgeted(intact, MAX_UNPACKED_BYTES, partial)).toBe(false);
    expect(await budgeted(intact, MAX_UNPACKED_BYTES, recorded(["zipinfo"]).run)).toBe(false);
    expect(await budgeted(intact, MAX_UNPACKED_BYTES, recorded().run)).toBe(true);
  },
  60_000
);
