import { describe, expect, test } from "bun:test";
import {
  compareVersions,
  type DaemonBuild,
  isDevVersion,
  platformFromUname,
  upgradeDue,
} from "./builds.ts";
import { type HostProbe, InstallPlan, planInstall } from "./plan.ts";

const build = (platform: DaemonBuild["platform"], version = "1.2.0"): DaemonBuild => ({
  platform,
  version,
  sha256: `sha-${platform}-${version}`,
  files: [
    { name: "polaris", path: `/dist/${platform}/polaris`, sha256: "x", size: 1, executable: true },
  ],
});

const linuxX64 = build("linux-x64");

const builds = [build("darwin-arm64"), linuxX64, build("linux-arm64")];

const linux = (installed: HostProbe["installed"] = null): HostProbe => ({
  os: "Linux",
  arch: "x86_64",
  installed,
});

const user = { trigger: "user", approvedSha256: new Set<string>() } as const;

describe("platformFromUname", () => {
  test("maps the shipped platforms", () => {
    expect(platformFromUname("Darwin", "arm64")).toBe("darwin-arm64");
    expect(platformFromUname("Linux", "x86_64")).toBe("linux-x64");
    expect(platformFromUname("Linux", "aarch64")).toBe("linux-arm64");
    expect(platformFromUname("Darwin", "x86_64")).toBeNull();
    expect(platformFromUname("FreeBSD", "amd64")).toBeNull();
  });
});

describe("compareVersions", () => {
  test("orders releases and prereleases", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("1.2.0", "1.2")).toBe(0);
    expect(compareVersions("1.2.0-rc.1", "1.2.0")).toBeLessThan(0);
    expect(compareVersions("1.2.0-rc.10", "1.2.0-rc.9")).toBeGreaterThan(0);
  });
});

describe("dev builds", () => {
  test("are recognised by their version", () => {
    expect(isDevVersion("0.0.0-dev.412.5821ca0")).toBe(true);
    expect(isDevVersion("0.0.0-dev.412.5821ca0.dirty1790787600")).toBe(true);
    expect(isDevVersion("1.2.0")).toBe(false);
    expect(isDevVersion("0.0.1-d210")).toBe(false);
  });

  test("replace any other version; releases only an older one", () => {
    const dev = "0.0.0-dev.412.5821ca0";

    // Newer, older, another branch's dev build, a hand-made prerelease: all replaced.
    for (const installed of ["0.0.0", "0.0.1-d210", "0.0.0-dev.413.aaaaaaa", "1.2.0"]) {
      expect(upgradeDue(installed, dev)).toBe(true);
    }

    expect(upgradeDue(dev, dev)).toBe(false);
    expect(upgradeDue("1.1.0", "1.2.0")).toBe(true);
    expect(upgradeDue("2.0.0", "1.2.0")).toBe(false);
    expect(upgradeDue("0.0.0-dev.412.5821ca0", "0.0.0")).toBe(true);
  });

  test("a Host on another build upgrades without a new approval", () => {
    const dev = build("linux-x64", "0.0.0-dev.412.5821ca0");

    for (const installed of ["0.0.1-d210", "0.0.0-dev.500.bbbbbbb"]) {
      expect(
        planInstall(linux({ version: installed, platform: "linux-x64" }), [dev], {
          trigger: "background",
          approvedSha256: new Set(),
        })
      ).toEqual(InstallPlan.Upgrade({ from: installed, build: dev }));
    }

    expect(
      planInstall(linux({ version: dev.version, platform: "linux-x64" }), [dev], user)
    ).toEqual(InstallPlan.UpToDate({ version: dev.version }));
  });
});

describe("planInstall", () => {
  test("a fresh Host needs approval of the exact build first", () => {
    expect(planInstall(linux(), builds, user)).toEqual(
      InstallPlan.NeedsApproval({
        platform: "linux-x64",
        version: "1.2.0",
        sha256: "sha-linux-x64-1.2.0",
        reason: "first-install",
      })
    );
  });

  test("installs once that SHA-256 is approved", () => {
    const plan = planInstall(linux(), builds, {
      trigger: "user",
      approvedSha256: new Set(["sha-linux-x64-1.2.0"]),
    });

    expect(plan).toEqual(InstallPlan.Install({ build: linuxX64 }));
  });

  test("never installs on a background reconnect, even if approved", () => {
    const plan = planInstall(linux(), builds, {
      trigger: "background",
      approvedSha256: new Set(["sha-linux-x64-1.2.0"]),
    });

    expect(plan).toEqual(
      InstallPlan.NeedsApproval({
        platform: "linux-x64",
        version: "1.2.0",
        sha256: "sha-linux-x64-1.2.0",
        reason: "background",
      })
    );
  });

  test("upgrades an older Daemon without asking again, also in the background", () => {
    const plan = planInstall(linux({ version: "1.1.0", platform: "linux-x64" }), builds, {
      trigger: "background",
      approvedSha256: new Set(),
    });

    expect(plan).toEqual(InstallPlan.Upgrade({ from: "1.1.0", build: linuxX64 }));
  });

  test("does nothing when up to date, and never downgrades", () => {
    expect(planInstall(linux({ version: "1.2.0", platform: "linux-x64" }), builds, user)).toEqual(
      InstallPlan.UpToDate({ version: "1.2.0" })
    );
    expect(planInstall(linux({ version: "2.0.0", platform: "linux-x64" }), builds, user)).toEqual(
      InstallPlan.InstalledNewer({ installed: "2.0.0", bundled: "1.2.0" })
    );
  });

  test("reports Hosts it cannot serve", () => {
    expect(planInstall({ os: "Darwin", arch: "x86_64", installed: null }, builds, user)).toEqual(
      InstallPlan.Unsupported({ os: "Darwin", arch: "x86_64" })
    );
    expect(planInstall(linux(), [build("darwin-arm64")], user)).toEqual(
      InstallPlan.MissingBuild({ platform: "linux-x64" })
    );
  });
});

describe("musl Hosts", () => {
  const withMusl = [...builds, build("linux-x64-musl"), build("linux-arm64-musl")];

  const approveMusl = InstallPlan.NeedsApproval({
    platform: "linux-arm64-musl",
    version: "1.2.0",
    sha256: "sha-linux-arm64-musl-1.2.0",
    reason: "first-install",
  });

  const alpine = (missingLibraries: ReadonlyArray<string> = []): HostProbe => ({
    os: "Linux",
    arch: "aarch64",
    libc: "musl",
    missingLibraries,
    installed: null,
  });

  test("map to the musl builds", () => {
    expect(platformFromUname("Linux", "x86_64", "musl")).toBe("linux-x64-musl");
    expect(platformFromUname("Linux", "aarch64", "musl")).toBe("linux-arm64-musl");
    expect(platformFromUname("Darwin", "arm64", "musl")).toBe("darwin-arm64");
    expect(planInstall(alpine(), withMusl, user)).toEqual(approveMusl);
  });

  test("are a MissingBuild when the Client bundles no musl build, never the glibc one", () => {
    expect(planInstall(alpine(), builds, user)).toEqual(
      InstallPlan.MissingBuild({ platform: "linux-arm64-musl" })
    );
  });

  test("without libstdc++/libgcc need an administrator first", () => {
    expect(planInstall(alpine(["libstdc++.so.6", "libgcc_s.so.1"]), withMusl, user)).toEqual(
      InstallPlan.MissingLibraries({
        platform: "linux-arm64-musl",
        libraries: ["libstdc++.so.6", "libgcc_s.so.1"],
        command: "apk add libstdc++ libgcc",
      })
    );
  });

  test("an installed glibc Daemon on a musl Host is replaced by the musl build", () => {
    const probe = { ...alpine(), installed: { version: "1.2.0", platform: "linux-arm64" } };
    expect(planInstall(probe, withMusl, user)).toEqual(approveMusl);
  });
});
