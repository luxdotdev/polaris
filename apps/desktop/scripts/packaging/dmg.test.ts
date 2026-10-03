import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Run } from "./command.ts";
import { installerDmg, signDmg } from "./dmg.ts";
import type { Signing } from "./release.ts";

const dirs: string[] = [];

const temporary = () => {
  const dir = mkdtempSync(join(tmpdir(), "polaris-dmg-test-"));
  dirs.push(dir);

  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const signing: Signing = {
  identity: "Developer ID Application: Test (TEAM123456)",
  teamId: "TEAM123456",
  appleApiKey: "/tmp/fake-key.p8",
  appleApiKeyId: "KEY1234567",
  appleApiIssuer: "fake-issuer",
  keychain: "/tmp/fake.keychain-db",
};

test("unsigned installer uses the locked headless builder and publishes only after verification", () => {
  const output = temporary();

  const commands: ReadonlyArray<string>[] = [];

  const execute: Run = (argv) => {
    commands.push(argv);

    if (argv[0] === "uv") writeFileSync(argv.at(-1)!, "built image");

    expect(existsSync(join(output, "Polaris-0.1.0-rc.1-arm64.dmg"))).toBe(false);

    return "";
  };

  const dmg = installerDmg("/dist/Polaris.app", "0.1.0-rc.1", output, "/assets", null, execute);

  expect(readFileSync(dmg, "utf8")).toBe("built image");

  expect(commands[0]?.slice(0, 4)).toEqual(["uv", "run", "--locked", "--script"]);

  expect(commands[0]?.slice(-3, -1)).toEqual(["/dist/Polaris.app", "/assets"]);

  expect(commands[1]).toEqual(["hdiutil", "verify", commands[0]!.at(-1)!]);

  expect(commands).toHaveLength(2);

  expect(readdirSync(output)).toEqual(["Polaris-0.1.0-rc.1-arm64.dmg"]);
});

test("signed DMG verifies the app first, then signs, waits for acceptance and validates its ticket", () => {
  const commands: ReadonlyArray<string>[] = [];

  const output = temporary();
  installerDmg("/dist/Polaris.app", "0.1.0", output, "/assets", signing, (argv) => {
    commands.push(argv);

    if (argv[0] === "uv") writeFileSync(argv.at(-1)!, "built image");

    return argv[1] === "notarytool" ? '{"status":"Accepted","id":"test-submission"}' : "";
  });

  expect(commands[0]).toEqual(["codesign", "--verify", "--deep", "--strict", "/dist/Polaris.app"]);

  expect(commands[1]).toEqual(["xcrun", "stapler", "validate", "/dist/Polaris.app"]);

  const image = commands[2]!.at(-1)!;

  expect(commands[3]).toEqual([
    "codesign",
    "--force",
    "--timestamp",
    "--sign",
    signing.identity,
    "--keychain",
    signing.keychain!,
    image,
  ]);

  expect(commands[4]).toEqual(["codesign", "--verify", "--strict", image]);

  expect(commands[5]).toEqual([
    "xcrun",
    "notarytool",
    "submit",
    image,
    "--key",
    signing.appleApiKey,
    "--key-id",
    signing.appleApiKeyId,
    "--issuer",
    signing.appleApiIssuer,
    "--wait",
    "--output-format",
    "json",
  ]);

  expect(commands.slice(6)).toEqual([
    ["xcrun", "stapler", "staple", image],
    ["xcrun", "stapler", "validate", image],
    ["hdiutil", "verify", image],
  ]);
});

test("failed build, signing, rejected notarisation or verification leaves no new artifact", () => {
  for (const failingStep of ["uv", "codesign", "notarytool", "staple", "validate", "hdiutil"]) {
    const output = temporary();

    const existing = join(output, "Polaris-0.1.0-arm64.dmg");
    writeFileSync(existing, "previous verified image");

    const execute: Run = (argv) => {
      if (argv[0] === "uv") writeFileSync(argv.at(-1)!, "built image");

      if (argv.includes(failingStep)) {
        if (failingStep === "notarytool") return '{"status":"Invalid","id":"rejected"}';
        throw new Error("fake tool failure");
      }

      return argv[1] === "notarytool" ? '{"status":"Accepted","id":"test"}' : "";
    };

    expect(() =>
      installerDmg("/dist/Polaris.app", "0.1.0", output, "/assets", signing, execute)
    ).toThrow();

    expect(readFileSync(existing, "utf8")).toBe("previous verified image");

    expect(readdirSync(output)).toEqual(["Polaris-0.1.0-arm64.dmg"]);
  }
});

test("malformed notary response fails closed and cannot reach stapler", () => {
  const commands: ReadonlyArray<string>[] = [];

  expect(() =>
    signDmg("/image.dmg", signing, (argv) => {
      commands.push(argv);

      return argv[1] === "notarytool" ? "{}" : "";
    })
  ).toThrow();

  expect(commands.some((argv) => argv.includes("stapler"))).toBe(false);
});
