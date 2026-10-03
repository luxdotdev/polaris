import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLATFORMS, loadBuilds } from "@polaris/client/install";
import { signDaemonBuilds, verifyDaemonManifest } from "./manifest.ts";
import { signingCredentials, type Signing } from "./release.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

const fixture = () => {
  const dist = mkdtempSync(join(tmpdir(), "polaris-release-test-"));
  dirs.push(dist);

  const platforms = Object.fromEntries(
    PLATFORMS.map((platform) => {
      mkdirSync(join(dist, platform));

      const files = Object.fromEntries(
        ["polaris", "betterleaks"].map((name) => {
          const bytes = `${platform}/${name}`;
          writeFileSync(join(dist, platform, name), bytes);

          return [
            name,
            {
              sha256: hash(bytes),
              size: Buffer.byteLength(bytes),
              executable: name === "betterleaks",
            },
          ];
        })
      );

      return [
        platform,
        { target: `bun-${platform}`, binary: "polaris", sha256: files.polaris!.sha256, files },
      ];
    })
  );

  writeFileSync(
    join(dist, "manifest.json"),
    JSON.stringify({
      version: "0.1.0-rc.1",
      commit: "commit",
      fff: { package: "fff", version: "1", embedded: true },
      astGrep: { package: "ast-grep", version: "1", embedded: true },
      betterleaks: { version: "1", file: "betterleaks" },
      platforms,
    })
  );

  return dist;
};

const signing: Signing = {
  ...signingCredentials({
    APPLE_TEAM_ID: "TEAM123456",
    APPLE_API_KEY: "/fake/key.p8",
    APPLE_API_KEY_ID: "KEY1234567",
    APPLE_API_ISSUER: "issuer",
  })!,
  identity: "test-identity",
  keychain: "/fake/keychain",
};

describe("shipped Daemon manifest", () => {
  test("hashes signed bytes, keeps Linux builds, and survives staging for remote Host installs", () => {
    const dist = fixture();
    const linuxBefore = readFileSync(join(dist, "linux-x64/polaris"));
    const commands: ReadonlyArray<string>[] = [];
    signDaemonBuilds(dist, signing, "/entitlements", (argv) => {
      commands.push(argv);

      if (argv[0] === "codesign" && argv.includes("--sign")) {
        const binary = argv.at(-1)!;
        writeFileSync(binary, Buffer.concat([readFileSync(binary), Buffer.from("-signed")]));
      }

      return argv[1] === "selftest" ? "polaris 0.1.0-rc.1 darwin-arm64\nfff ok" : "";
    });
    verifyDaemonManifest(dist, "0.1.0-rc.1");
    expect(readFileSync(join(dist, "linux-x64/polaris"))).toEqual(linuxBefore);
    const signed = commands.filter((argv) => argv.includes("--sign"));
    expect(signed).toHaveLength(2);
    expect(signed[0]).toContain("runtime");
    expect(signed[0]).toContain("--timestamp");
    expect(signed[0]).toContain("/fake/keychain");
    expect(signed[0]).toContain("/entitlements/daemon.plist");
    expect(signed[1]).toContain("/entitlements/betterleaks.plist");
    const stage = join(dist, "staged");
    mkdirSync(stage);

    for (const name of [...PLATFORMS, "manifest.json"])
      cpSync(join(dist, name), join(stage, name), { recursive: true });
    verifyDaemonManifest(stage, "0.1.0-rc.1");
    const mac = loadBuilds(stage).find((build) => build.platform === "darwin-arm64")!;

    for (const file of mac.files) {
      expect(file.sha256).toBe(hash(readFileSync(file.path)));
      expect(readFileSync(file.path).toString()).toEndWith("-signed");
    }

    expect(mac.sha256).toBe(mac.files[0]!.sha256);
    expect(mac.files[1]!.executable).toBe(true);
  });

  test("unsigned builds keep their manifest and never call signing tools", () => {
    const dist = fixture();
    const before = readFileSync(join(dist, "manifest.json"));
    signDaemonBuilds(dist, null, "/entitlements", () => {
      throw new Error("unexpected signing");
    });
    expect(readFileSync(join(dist, "manifest.json"))).toEqual(before);
  });

  test("rejects mismatched, stale or incomplete release builds", () => {
    const dist = fixture();
    expect(() => verifyDaemonManifest(dist, "0.2.0")).toThrow("does not match release");
    writeFileSync(join(dist, "linux-x64/polaris"), "changed");
    expect(() => verifyDaemonManifest(dist)).toThrow("bytes differ");
    const incomplete = fixture();
    const builds = loadBuilds(incomplete);
    writeFileSync(
      join(incomplete, "manifest.json"),
      readFileSync(join(incomplete, "manifest.json"), "utf8").replace(
        '"linux-arm64-musl":',
        '"unexpected":'
      )
    );
    expect(builds).toHaveLength(5);
    expect(() => verifyDaemonManifest(incomplete, "0.1.0-rc.1")).toThrow(
      "missing linux-arm64-musl"
    );
  });

  test("a failed signer or signed selftest cannot produce a refreshed manifest", () => {
    const dist = fixture();
    const before = readFileSync(join(dist, "manifest.json"));
    expect(() =>
      signDaemonBuilds(dist, signing, "/entitlements", () => {
        throw new Error("signing failed");
      })
    ).toThrow("signing failed");
    expect(() => signDaemonBuilds(dist, signing, "/entitlements", () => "wrong version")).toThrow(
      "selftest"
    );
    expect(readFileSync(join(dist, "manifest.json"))).toEqual(before);
  });
});
