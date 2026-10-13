import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { windowsIcon } from "./icon.ts";
import { assertReleaseVersions, resolveSigning } from "./release.ts";
import { packageTargets, targetOptions } from "./targets.ts";
import { verifyWindowsRelease, windowsInstallerOptions } from "./windows.ts";

test("Windows builds reuse Daemons, validate release versions and remain unsigned", () => {
  expect(packageTargets(["--windows", "--reuse-daemon"])).toEqual([
    { platform: "win32", arch: "x64" },
    { platform: "win32", arch: "arm64" },
  ]);
  expect(() => packageTargets(["--windows"])).toThrow("--reuse-daemon");
  expect(() => packageTargets(["--windows", "--reuse-daemon", "--linux"])).toThrow("--linux");
  expect(packageTargets([])).toEqual([{ platform: "darwin", arch: "arm64" }]);
  expect(packageTargets(["--linux"])).toContainEqual({ platform: "linux", arch: "x64" });
  expect(
    resolveSigning(
      null,
      () => {
        throw new Error("must not run codesign");
      },
      "win32"
    )
  ).toBe("unsigned");
  expect(() => assertReleaseVersions("1.2.3", "1.2.3", true, "win32")).not.toThrow();
  expect(() => assertReleaseVersions("1.2.3", "1.2.2", true, "win32")).toThrow("version mismatch");
  expect(() => assertReleaseVersions("1.2.3", "1.2.3", true, "darwin")).toThrow("--reuse-daemon");
});

test.each(["x64", "arm64"] as const)("Windows %s executable and installer metadata", (arch) => {
  const target = targetOptions({ platform: "win32", arch }, "/icons");
  expect(target.icon).toBe(join("/icons", "Polaris.ico"));
  expect(target.win32metadata?.OriginalFilename).toBe("Polaris.exe");
  const options = windowsInstallerOptions("/app", "1.2.3", arch, "/out", "/icons");
  expect(options).toMatchObject({
    name: `Polaris-${arch}-win`,
    exe: "Polaris.exe",
    noMsi: true,
    noDelta: true,
    setupExe: `Polaris-1.2.3-${arch}-win-Setup.exe`,
  });
  expect(options.certificateFile).toBeUndefined();
  expect(options.windowsSign).toBeUndefined();
  expect(targetOptions({ platform: "linux", arch: "x64" }, "/icons").win32metadata).toBeUndefined();
});

test("ICO holds all existing native PNG sizes byte for byte", () => {
  const icons = join(import.meta.dir, "../../../../design/assets/app-icon");
  const source = join(icons, "linux");
  const ico = windowsIcon(source);
  expect(ico).toEqual(readFileSync(join(icons, "Polaris.ico")));
  expect(ico.readUInt16LE(2)).toBe(1);
  expect(ico.readUInt16LE(4)).toBe(6);

  for (const [index, size] of [16, 32, 48, 64, 128, 256].entries()) {
    const entry = 6 + index * 16;
    expect(ico[entry]).toBe(size === 256 ? 0 : size);
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    expect(ico.subarray(offset, offset + length)).toEqual(
      readFileSync(join(source, `${size}x${size}.png`))
    );
  }
});

test.each(["1.2.3", "1.2.3-rc.1"])(
  "Squirrel %s output must match the package hash and size",
  (version) => {
    const output = mkdtempSync(join(tmpdir(), "polaris-squirrel-"));

    try {
      const name = `Polaris-arm64-win-${version.replace("-rc.", "-rc")}-full.nupkg`;
      const bytes = Buffer.from("fake package bytes");
      writeFileSync(join(output, name), bytes);
      writeFileSync(join(output, `Polaris-${version}-arm64-win-Setup.exe`), "fake installer");
      const releases = `${createHash("sha1").update(bytes).digest("hex")} ${name} ${bytes.length}\n`;
      writeFileSync(join(output, "RELEASES"), releases);
      expect(() => verifyWindowsRelease(output, version, "arm64")).not.toThrow();
      writeFileSync(join(output, name), "tampered");
      expect(() => verifyWindowsRelease(output, version, "arm64")).toThrow("does not match");
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  }
);
