import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import type { FeedURLOptions } from "electron";
import { cannotInstallHere } from "./identity.ts";
import { createAppUpdates, versionFromAsset, type UpdateInput } from "./index.ts";
import { revealAppPath, updateFeed, updatePlatform, windowsAppId } from "./platform.ts";
import { handleSquirrelStartup, squirrelCommand } from "./squirrel.ts";

const exe = "C:\\Users\\me\\AppData\\Local\\Polaris-arm64-win\\app-1.2.3\\Polaris.exe";

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
  expect(
    handleSquirrelStartup("win32", [exe, "--squirrel-install"], exe, async () => {
      throw new Error("failed");
    })
  ).rejects.toThrow("failed");
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

class Updater extends EventEmitter {
  getFeedURL() {
    return this.feed?.url ?? "";
  }
  feed: FeedURLOptions | null = null;
  checks = 0;
  installs = 0;
  setFeedURL(feed: FeedURLOptions) {
    this.feed = feed;
  }
  checkForUpdates() {
    this.checks++;
  }
  quitAndInstall() {
    this.installs++;
  }
}

const fixture = (patch: Partial<UpdateInput> = {}) => {
  const native = new Updater();
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const pending = new Set<() => void>();

  const updates = createAppUpdates({
    native,
    platform: "win32",
    arch: "arm64",
    macOSVersion: "10.0.26100",
    version: "1.2.2",
    installId: "58baf1dc-3772-4353-86b3-3a8a49219521",
    supported: true,
    blocked: false,
    automatic: true,
    lastCheckedAt: null,
    save() {},
    publish() {},
    fetch: async (url, init) => {
      requests.push({ url, init });

      return new Response("fake RELEASES");
    },
    schedule: (run) => {
      pending.add(run);

      return () => {
        pending.delete(run);
      };
    },
    ...patch,
  });

  return { updates, native, requests, pending };
};

test.each(["x64", "arm64"])("%s update feed and Windows native version metadata", async (arch) => {
  const { updates, native, requests } = fixture({ arch });
  updates.start();
  updates.check();
  await Promise.resolve();
  expect(native.checks).toBe(1);
  expect(native.feed?.url).toBe(updateFeed("https://polaris.lux.dev", "win32", arch, "1.2.2"));
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe(`${native.feed?.url}/RELEASES`);
  const headers = new Headers(requests[0]?.init.headers);
  expect(headers.get("X-Polaris-Windows-Version")).toBe("10.0.26100");
  expect(headers.get("X-Polaris-Install-ID")).toBe(updates.get().installId);
  expect(headers.has("X-Polaris-macOS-Version")).toBe(false);
  native.emit("update-downloaded", {}, "notes", "1.2.3", new Date(), native.feed?.url);
  expect(updates.get().availableVersion).toBe("1.2.3");
  updates.install();
  expect(native.installs).toBe(1);
  updates.dispose();
});

test("first launch avoids Squirrel's file lock, opt-out manual check omits identity", async () => {
  const { updates, native, requests, pending } = fixture({ firstRun: true });
  updates.start();
  expect(requests).toHaveLength(0);
  expect(pending.size).toBe(1);
  updates.setAutomatic(false);
  updates.check();
  await Promise.resolve();
  expect(new Headers(requests[0]?.init.headers).has("X-Polaris-Install-ID")).toBe(false);
  expect(native.checks).toBe(1);
  expect(pending.size).toBe(0);
  updates.dispose();
});

test("preflight current/failure and disposal never trigger a native download", async () => {
  for (const status of [204, 503]) {
    const { updates, native } = fixture({ fetch: async () => new Response(null, { status }) });
    updates.check();
    await Promise.resolve();
    expect(updates.get().phase).toBe(status === 204 ? "current" : "failed");
    expect(native.checks).toBe(0);
    updates.dispose();
  }

  let respond: (response: Response) => void = () => {};

  const { updates, native } = fixture({
    fetch: () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  });

  updates.check();
  updates.dispose();
  respond(new Response("fake RELEASES"));
  await Promise.resolve();
  expect(native.checks).toBe(0);
});

test("platform support and Windows asset versions exclude other builds", () => {
  expect(updatePlatform("win32", "ia32")).toBeNull();
  expect(updatePlatform("linux", "x64")).toBeNull();
  expect(updatePlatform("darwin", "arm64")).toBe("darwin-arm64");
  expect(versionFromAsset("https://example.test/Polaris-x64-win-1.2.3-full.nupkg")).toBe("1.2.3");
  expect(versionFromAsset("https://example.test/Polaris-1.2.3-arm64-win-Setup.exe")).toBe("1.2.3");
  expect(versionFromAsset("https://example.test/Polaris-x64-win-01.2.3-full.nupkg")).toBeNull();
});
