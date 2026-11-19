import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { cannotInstallHere } from "./identity.ts";
import { UPDATE_BASE_URL, versionFromAsset, versionFromNuget } from "./index.ts";
import { revealAppPath, updatePlatform, windowsAppId } from "./platform.ts";
import { bytesOf, fixture, serveAsset, type Asset } from "./updates.testing.ts";
import { verifyWindowsUpdate } from "./verify.ts";
import { handleSquirrelStartup, repairSquirrelFirstRun, squirrelCommand } from "./squirrel.ts";

const exe = "C:\\Users\\me\\AppData\\Local\\Polaris-arm64-win\\app-1.2.3\\Polaris.exe";

test("Windows first launch repairs shortcuts after a timed-out maintenance hook", async () => {
  const calls: string[][] = [];

  const execute = async (_exe: string, args: string[]) => {
    calls.push(args);
  };

  await repairSquirrelFirstRun("win32", [exe, "--squirrel-firstrun"], exe, execute);
  await repairSquirrelFirstRun("win32", [exe], exe, execute);
  await repairSquirrelFirstRun("darwin", [exe, "--squirrel-firstrun"], exe, execute);
  expect(calls).toEqual([["--createShortcut", "Polaris.exe"]]);
});

test("maintenance events create/remove shortcuts; first run remains a normal launch", async () => {
  const calls: Array<{ exe: string; args: string[] }> = [];

  const run = async (exe: string, args: string[]) => {
    calls.push({ exe, args });
  };

  for (const event of ["install", "updated", "uninstall", "obsolete"])
    expect(await handleSquirrelStartup("win32", [exe, `--squirrel-${event}`], exe, run)).toBe(true);
  expect(calls).toEqual([
    {
      exe: "C:\\Users\\me\\AppData\\Local\\Polaris-arm64-win\\Update.exe",
      args: ["--createShortcut", "Polaris.exe"],
    },
    {
      exe: "C:\\Users\\me\\AppData\\Local\\Polaris-arm64-win\\Update.exe",
      args: ["--createShortcut", "Polaris.exe"],
    },
    {
      exe: "C:\\Users\\me\\AppData\\Local\\Polaris-arm64-win\\Update.exe",
      args: ["--removeShortcut", "Polaris.exe"],
    },
  ]);
  expect(squirrelCommand("darwin", [exe, "--squirrel-install"], exe)).toBeNull();
  expect(squirrelCommand("win32", [exe, "--squirrel-firstrun"], exe)).toBeNull();
  expect(squirrelCommand("win32", [exe, "--squirrel-unknown"], exe)).toBeNull();
  await Promise.resolve(
    expect(
      handleSquirrelStartup("win32", [exe, "--squirrel-install"], exe, async () => {
        throw new Error("failed");
      })
    ).rejects.toThrow("failed")
  );
});

test("installed Squirrel layout permits updates; unpacked and zip layouts are blocked", () => {
  const exists = (path: string) =>
    path === "C:\\Users\\me\\AppData\\Local\\Polaris-arm64-win\\Update.exe";

  expect(cannotInstallHere("ignored", "ignored", "win32", exe, exists)).toBe(false);
  expect(cannotInstallHere("ignored", "ignored", "win32", exe, () => false)).toBe(true);
  expect(
    cannotInstallHere(
      "ignored",
      "ignored",
      "win32",
      "C:\\Downloads\\Polaris-win32-arm64\\Polaris.exe",
      () => true
    )
  ).toBe(true);
  expect(revealAppPath("win32", exe)).toBe(exe);
  expect(revealAppPath("darwin", "/Applications/Polaris.app/Contents/MacOS/Polaris")).toBe(
    join("/Applications/Polaris.app")
  );
  expect(windowsAppId("arm64")).toBe("com.squirrel.Polaris-arm64-win.Polaris");
});

const RELEASES = (arch: string) => `${UPDATE_BASE_URL}/api/update/win32-${arch}/1.2.2/RELEASES`;

const nupkg = (arch: string) =>
  `https://github.com/luxdotdev/polaris/releases/download/v1.2.3/Polaris-${arch}-win-1.2.3-full.nupkg`;

const sha1 = (bytes: Uint8Array) => createHash("sha1").update(bytes).digest("hex");

/** The site's RELEASES for 1.2.3, and GitHub serving the package it names. */
const offering =
  (arch: string, asset: Asset, hash = sha1(asset.bytes)) =>
  (url: string, init: RequestInit) => {
    if (url === RELEASES(arch))
      return Promise.resolve(new Response(`${hash} ${asset.url} ${asset.bytes.length}`));

    if (url === asset.url) return Promise.resolve(serveAsset(asset, init));

    return Promise.reject(new Error("unexpected outbound request"));
  };

const windows = (patch: Parameters<typeof fixture>[0] = {}) =>
  fixture({
    platform: "win32",
    arch: "arm64",
    osVersion: "10.0.26100",
    version: "1.2.2",
    // The real Windows check: the size and SHA-1 from RELEASES.
    verify: verifyWindowsUpdate,
    ...patch,
  });

test.each(["x64", "arm64"])(
  "%s: the preflight carries the headers; Squirrel gets RELEASES and the package from loopback",
  async (arch) => {
    const asset: Asset = { url: nupkg(arch), bytes: bytesOf(6000) };
    const f = windows({ arch, internet: offering(arch, asset) });

    f.updates.start();
    await f.settled();
    await f.native.done;
    expect(f.requests.map((r) => r.url)).toEqual([RELEASES(arch), asset.url]);
    expect(f.requests[0]?.headers.get("X-Polaris-Windows-Version")).toBe("10.0.26100");
    expect(f.requests[0]?.headers.get("X-Polaris-Install-ID")).toBe(f.updates.get().installId);
    expect(f.requests[0]?.headers.has("X-Polaris-macOS-Version")).toBe(false);
    expect(f.updates.get()).toMatchObject({ platform: "win32", osVersion: "10.0.26100" });
    expect(f.views.find((view) => view.download !== null)?.download).toEqual({
      version: "1.2.3",
      receivedBytes: 0,
      totalBytes: 6000,
    });

    // Squirrel asked 127.0.0.1 for RELEASES, then for the package named beside it.
    expect(f.native.feed?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{48}$/);
    expect(f.native.asked.map((url) => url.replace(f.native.feed?.url ?? "", ""))).toEqual([
      "/RELEASES?id=Polaris&localVersion=1.2.2",
      `/Polaris-${arch}-win-1.2.3-full.nupkg`,
    ]);
    expect(f.native.received).toEqual(asset.bytes);
    expect(f.updates.get()).toMatchObject({ phase: "ready", readyVersion: "1.2.3" });
    f.updates.install();
    expect(f.native.installs).toBe(1);
    f.cleanup();
  }
);

test("a package whose SHA-1 or size differs from RELEASES never reaches Squirrel", async () => {
  const asset: Asset = { url: nupkg("arm64"), bytes: bytesOf(6000) };
  const f = windows({ internet: offering("arm64", asset, "0".repeat(40)) });

  await f.checked();
  expect(f.updates.get()).toMatchObject({
    phase: "failed",
    failure: { stage: "verify", version: "1.2.3" },
  });
  expect(f.native.checks).toBe(0);
  f.cleanup();
});

test("first launch avoids Squirrel's file lock, opt-out manual check omits identity", async () => {
  const f = windows({ firstRun: true });
  f.updates.start();
  expect(f.requests).toHaveLength(0);
  expect(f.pending.size).toBe(1);
  f.updates.setAutomatic(false);
  await f.checked();
  expect(f.requests[0]?.headers.has("X-Polaris-Install-ID")).toBe(false);
  expect(f.pending.size).toBe(0);
  f.cleanup();
});

test("preflight current/failure and disposal never trigger a native download", async () => {
  const answers: ReadonlyArray<readonly [Response, "current" | "failed"]> = [
    [new Response(null, { status: 204 }), "current"],
    [new Response(null, { status: 503 }), "failed"],
    [new Response("not a RELEASES line"), "failed"],
    [
      new Response(`${"a".repeat(40)} ${nupkg("arm64")} 10
${"b".repeat(40)} ${nupkg("x64")} 10`),
      "failed",
    ],
  ];

  for (const [response, phase] of answers) {
    const f = windows({ internet: () => Promise.resolve(response) });
    await f.checked();
    expect(f.updates.get().phase).toBe(phase);
    expect(f.requests).toHaveLength(1);
    expect(f.native.checks).toBe(0);
    f.cleanup();
  }

  let respond: (response: Response) => void = () => {};

  const f = windows({
    internet: () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  });

  f.updates.check();
  f.updates.dispose();
  respond(new Response(`${"a".repeat(40)} ${nupkg("arm64")} 10`));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(f.requests).toHaveLength(1);
  expect(f.native.checks).toBe(0);
  f.cleanup();
});

test("platform support and Windows asset versions exclude other builds", () => {
  expect(updatePlatform("win32", "ia32")).toBeNull();
  expect(updatePlatform("linux", "x64")).toBeNull();
  expect(updatePlatform("darwin", "arm64")).toBe("darwin-arm64");
  expect(versionFromAsset("https://example.test/Polaris-x64-win-1.2.3-full.nupkg")).toBe("1.2.3");
  expect(versionFromAsset("https://example.test/Polaris-1.2.3-arm64-win-Setup.exe")).toBe("1.2.3");
  expect(versionFromAsset("https://example.test/Polaris-x64-win-01.2.3-full.nupkg")).toBeNull();
});

test("prerelease assets and NuGet names map back to the release's semver", () => {
  expect(versionFromAsset("https://example.test/Polaris-x64-win-0.1.0-alpha1-full.nupkg")).toBe(
    "0.1.0-alpha.1"
  );
  expect(versionFromAsset("https://example.test/Polaris-0.1.0-beta.2-arm64-win-Setup.exe")).toBe(
    "0.1.0-beta.2"
  );
  expect(versionFromAsset("https://example.test/Polaris-0.1.0-rc.10-arm64-mac.zip")).toBe(
    "0.1.0-rc.10"
  );
  expect(versionFromAsset("https://example.test/Polaris-0.1.0-dev.1-arm64-mac.zip")).toBeNull();
  expect(versionFromNuget("0.1.0-alpha1")).toBe("0.1.0-alpha.1");
  expect(versionFromNuget("0.1.0")).toBe("0.1.0");
  expect(versionFromNuget("0.1.0-alpha01")).toBeNull();
});
