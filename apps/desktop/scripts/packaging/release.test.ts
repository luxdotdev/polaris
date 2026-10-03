import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  assertReleaseVersions,
  daemonBuildCommand,
  macSigningOptions,
  preserveDaemonSignature,
  selectIdentity,
  signingCredentials,
  type Signing,
  updateZip,
} from "./release.ts";

const env = {
  APPLE_TEAM_ID: "TEAM123456",
  APPLE_API_KEY: "/tmp/key.p8",
  APPLE_API_KEY_ID: "KEY1234567",
  APPLE_API_ISSUER: "test-issuer",
};

const identity = "Developer ID Application: Polaris (TEAM123456)";

const hash = "A".repeat(40);

const signing: Signing = { ...signingCredentials(env)!, identity: hash };

describe("release packaging", () => {
  test("release validates versions and rebuilds all Daemons with --release", () => {
    expect(() => assertReleaseVersions("0.1.0-rc.1", "0.1.0-rc.1", false)).not.toThrow();
    expect(() => assertReleaseVersions("0.1.0", "0.0.0", false)).toThrow("version mismatch");
    expect(() => assertReleaseVersions("0.1.0", "0.1.0", true)).toThrow("--reuse-daemon");
    expect(daemonBuildCommand("/repo", true)).toEqual([
      process.execPath,
      "/repo/scripts/build-daemon.ts",
      "--release",
    ]);
    expect(daemonBuildCommand("/repo", false)).not.toContain("--release");
  });

  test("no credentials skip signing; incomplete credentials fail closed", () => {
    expect(signingCredentials({ APPLE_TEAM_ID: "" })).toBeNull();
    expect(macSigningOptions(null, "/entitlements")).toEqual({});

    for (const key of Object.keys(env)) {
      expect(() => signingCredentials({ ...env, [key]: undefined })).toThrow(
        "incomplete signing credentials"
      );
    }

    expect(() => signingCredentials({ MACOS_CERT_P12: "present" })).toThrow(
      "incomplete signing credentials"
    );
  });

  test("identity selection requires Developer ID and the configured team", () => {
    const output = `1) ${hash} "${identity}"\n2) ${"B".repeat(40)} "Apple Development: Test (TEAM123456)"`;
    expect(selectIdentity(signingCredentials(env)!, output)).toBe(hash);
    expect(() =>
      selectIdentity(signingCredentials(env)!, output.replace("TEAM123456", "OTHERTEAM1"))
    ).toThrow("expected one valid");
    expect(() =>
      selectIdentity(signingCredentials(env)!, `${output}\n3) ${"C".repeat(40)} "${identity}"`)
    ).toThrow("expected one valid");
    expect(
      selectIdentity(
        { ...signingCredentials(env)!, identity: hash },
        `${output}\n3) ${"C".repeat(40)} "${identity}"`
      )
    ).toBe(hash);
    expect(() => selectIdentity({ ...signingCredentials(env)!, identity: "-" }, output)).toThrow(
      "expected one valid"
    );
  });

  test("Electron signing fails on errors and preserves shipped Daemon signatures", () => {
    const options = macSigningOptions(signing, "/entitlements");
    const osxSign = options.osxSign;

    if (!osxSign || osxSign === true) throw new Error("missing explicit signing options");
    expect(osxSign.continueOnError).toBe(false);
    expect(osxSign.optionsForFile?.("/app", { platform: "darwin" })).toEqual({
      entitlements: "/entitlements/electron.plist",
      hardenedRuntime: true,
    });
    expect(options.osxNotarize).toEqual({
      appleApiKey: env.APPLE_API_KEY,
      appleApiKeyId: env.APPLE_API_KEY_ID,
      appleApiIssuer: env.APPLE_API_ISSUER,
    });
    expect(
      preserveDaemonSignature("/stage/Polaris.app/Contents/Resources/daemon/darwin-arm64/polaris")
    ).toBe(true);
    expect(
      preserveDaemonSignature("/stage/Polaris.app/Contents/Resources/daemon/linux-x64/polaris")
    ).toBe(true);
    expect(
      preserveDaemonSignature("/stage/Polaris.app/Contents/Frameworks/Electron Framework.framework")
    ).toBe(false);
    expect(preserveDaemonSignature("/stage/Polaris.app/Contents/Resources/daemon-other/tool")).toBe(
      false
    );
  });

  test("archives only after signature and stapled ticket verification, preserving symlinks", () => {
    const commands: ReadonlyArray<string>[] = [];

    const zip = updateZip("/dist/Polaris.app", "0.1.0-rc.1", "/dist", signing, (argv) => {
      commands.push(argv);

      return "";
    });

    expect(zip).toBe(join("/dist", "Polaris-0.1.0-rc.1-arm64-mac.zip"));
    expect(commands).toEqual([
      ["codesign", "--verify", "--deep", "--strict", "/dist/Polaris.app"],
      ["xcrun", "stapler", "validate", "/dist/Polaris.app"],
      ["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", "/dist/Polaris.app", zip],
    ]);
    expect(() =>
      updateZip("/app", "0.1.0", "/dist", signing, () => {
        throw new Error("invalid ticket");
      })
    ).toThrow("invalid ticket");
    commands.length = 0;
    updateZip("/app", "0.1.0", "/dist", null, (argv) => {
      commands.push(argv);

      return "";
    });
    expect(commands.map((argv) => argv[0])).toEqual(["ditto"]);
  });
});
