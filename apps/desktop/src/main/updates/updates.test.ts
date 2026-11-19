import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECK_INTERVAL_MS, UPDATE_BASE_URL, versionFromAsset } from "./index.ts";
import { cannotInstallHere, installId } from "./identity.ts";
import {
  bytesOf,
  FakeSquirrel,
  fixture,
  get,
  serveAsset,
  until,
  type Asset,
} from "./updates.testing.ts";

const FEED = `${UPDATE_BASE_URL}/api/update/darwin-arm64/0.4.0`;

const ZIP =
  "https://github.com/luxdotdev/polaris/releases/download/v0.5.0/Polaris-0.5.0-arm64-mac.zip";

const release = {
  url: ZIP,
  name: "Release title",
  notes: "notes",
  pub_date: "2026-10-02T00:00:00Z",
};

/** The site's feed offering 0.5.0, and GitHub serving its zip. */
const offering = (asset: Asset) => (url: string, init: RequestInit) => {
  if (url === FEED) return Promise.resolve(Response.json(release));

  if (url === asset.url) return Promise.resolve(serveAsset(asset, init));

  return Promise.reject(new Error("unexpected outbound request"));
};

describe("Polaris downloads the Update itself", () => {
  test("progress reaches the shared state, then Squirrel installs from the loopback feed", async () => {
    const asset: Asset = { url: ZIP, bytes: bytesOf(10_000) };
    const f = fixture({ internet: offering(asset) });

    await f.checked();
    await f.native.done;
    const downloads = f.views.flatMap((view) => (view.download === null ? [] : [view.download]));
    const received = downloads.map((download) => download.receivedBytes);

    expect(downloads.every((d) => d.version === "0.5.0")).toBe(true);
    expect(received).toEqual([...received].sort((a, b) => a - b));
    expect(new Set(received).size).toBeGreaterThan(5);
    expect(downloads.at(-1)).toEqual({
      version: "0.5.0",
      receivedBytes: 10_000,
      totalBytes: 10_000,
    });

    // Squirrel was pointed at loopback, never at the internet feed, and got the same bytes.
    expect(f.native.asked).toHaveLength(2);
    expect(f.native.asked.every((url) => url.startsWith("http://127.0.0.1:"))).toBe(true);
    expect(f.native.asked[1]?.endsWith("/Polaris-0.5.0-arm64-mac.zip")).toBe(true);
    expect(f.native.received).toEqual(asset.bytes);
    expect(f.updates.get()).toMatchObject({
      phase: "ready",
      readyVersion: "0.5.0",
      availableVersion: "0.5.0",
      download: null,
      failure: null,
      lastCheckedAt: 1234,
    });

    // The local feed is gone once Squirrel has the Update, and so is Polaris's copy.
    expect(await get(f.native.asked[0] ?? "").catch(() => "closed")).toBe("closed");
    f.updates.install();
    expect(f.native.installs).toBe(1);
    f.cleanup();
  });

  test("a download that fails verification is deleted and never reaches Squirrel", async () => {
    const asset: Asset = { url: ZIP, bytes: bytesOf(4000) };
    const seen: Array<{ bytes: number; file: string }> = [];

    const f = fixture({
      internet: offering(asset),
      verify: (path, update, bytes) => {
        seen.push({ bytes, file: update.file });

        return Promise.resolve(statSync(path).size !== 4000);
      },
    });

    await f.checked();
    expect(seen).toEqual([{ bytes: 4000, file: "Polaris-0.5.0-arm64-mac.zip" }]);
    expect(f.updates.get()).toMatchObject({
      phase: "failed",
      failure: { stage: "verify", version: "0.5.0", percent: null },
      readyVersion: null,
      download: null,
    });
    expect(f.native.checks).toBe(0);
    expect(readdirSync(f.pendingDir)).toEqual([]);
    f.updates.install();
    expect(f.native.installs).toBe(0);

    // The next try starts from the first byte, not from the rejected file.
    await f.checked();
    expect(f.requests.filter((r) => r.url === ZIP).map((r) => r.headers.get("Range"))).toEqual([
      null,
      null,
    ]);
    f.cleanup();
  });

  test("a dropped connection says how far it got; the next check resumes from there", async () => {
    const asset: Asset = { url: ZIP, bytes: bytesOf(10_000), dropAfter: 6000 };
    const f = fixture({ internet: offering(asset) });

    await f.checked();
    expect(f.updates.get()).toMatchObject({
      phase: "failed",
      failure: { stage: "download", version: "0.5.0", percent: 60 },
      download: null,
    });
    expect(f.native.checks).toBe(0);
    expect(f.pending.size).toBe(1);

    await f.checked();
    await f.native.done;
    expect(f.requests.filter((r) => r.url === ZIP).map((r) => r.headers.get("Range"))).toEqual([
      null,
      "bytes=6000-",
    ]);
    expect(f.updates.get().phase).toBe("ready");
    expect(f.native.received).toEqual(asset.bytes);
    f.cleanup();
  });

  test("a server that ignores the resume point restarts the file instead of corrupting it", async () => {
    const asset: Asset = { url: ZIP, bytes: bytesOf(5000), dropAfter: 2000, ignoreRange: true };
    const f = fixture({ internet: offering(asset) });

    await f.checked();
    await f.checked();
    await f.native.done;
    expect(f.updates.get().phase).toBe("ready");
    expect(f.native.received).toEqual(asset.bytes);
    f.cleanup();
  });

  test("Squirrel refusing the Update is a failed download, with no upstream text", async () => {
    const native = new FakeSquirrel();
    native.rejects = true;
    const f = fixture({ internet: offering({ url: ZIP, bytes: bytesOf(3000) }) }, native);

    await f.checked();
    await native.done;
    expect(f.updates.get()).toMatchObject({
      phase: "failed",
      failure: { stage: "verify", version: "0.5.0" },
      readyVersion: null,
    });
    expect(JSON.stringify(f.updates.get())).not.toContain("private Squirrel");
    expect(await get(native.feed?.url ?? "").catch(() => "closed")).toBe("closed");
    f.cleanup();
  });

  test("an asset that isn't an https Polaris zip is never downloaded", async () => {
    for (const url of [
      "http://github.com/luxdotdev/polaris/releases/download/v0.5.0/Polaris-0.5.0-arm64-mac.zip",
      "https://github.com/luxdotdev/polaris/releases/download/v0.5.0/Other.zip",
    ]) {
      const f = fixture({ internet: () => Promise.resolve(Response.json({ ...release, url })) });

      await f.checked();
      expect(f.updates.get()).toMatchObject({ phase: "failed", failure: { stage: "check" } });
      expect(f.requests).toHaveLength(1);
      f.cleanup();
    }
  });

  test("disposal stops a download in flight and never asks Squirrel", async () => {
    const asset: Asset = { url: ZIP, bytes: bytesOf(50_000), chunk: 100, delayMs: 2 };
    const f = fixture({ internet: offering(asset) });

    f.updates.check();
    await until(() => (f.updates.get().download?.receivedBytes ?? 0) > 0);
    f.updates.dispose();
    const asked = f.views.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(f.native.checks).toBe(0);
    expect(f.views).toHaveLength(asked);
    expect(readdirSync(f.pendingDir)).toEqual(["Polaris-0.5.0-arm64-mac.zip.part"]);
    f.cleanup();
  });
});

describe("Desktop App Updates", () => {
  test("packaged supported launch checks once; one six-hour timer, then disposal", async () => {
    const f = fixture();
    f.updates.start();
    expect(f.updates.get().phase).toBe("checking");
    expect(f.pending.size).toBe(1);
    expect(f.delays).toEqual([CHECK_INTERVAL_MS]);
    await f.settled();
    expect(f.requests.map((r) => r.url)).toEqual([FEED]);
    expect(f.updates.get().phase).toBe("current");
    expect(f.updates.get().lastCheckedAt).toBe(1234);
    f.tick();
    await f.settled();
    expect(f.requests).toHaveLength(2);
    expect(f.pending.size).toBe(1);
    f.cleanup();
    expect(f.pending.size).toBe(0);
    expect(f.native.listenerCount("update-downloaded")).toBe(0);
  });

  test("off stops automatic requests and ID; Check now still works, re-enable persists", async () => {
    const f = fixture({ automatic: false });
    f.updates.start();
    expect(f.requests).toHaveLength(0);
    expect(f.pending.size).toBe(0);
    await f.checked();
    expect(Object.fromEntries(f.requests[0]?.headers ?? [])).toEqual({
      "x-polaris-macos-version": "26.1",
    });
    f.updates.setAutomatic(true);
    await f.checked();
    expect(f.requests[1]?.headers.get("X-Polaris-Install-ID")).toBe(f.updates.get().installId);
    f.updates.setAutomatic(false);
    expect(f.pending.size).toBe(0);
    expect(f.saves).toContainEqual({ automaticAppUpdates: false });
    await f.checked();
    expect(f.requests[2]?.headers.has("X-Polaris-Install-ID")).toBe(false);
    f.cleanup();
  });

  test("busy/ready checks are deduplicated; no install until Squirrel has the Update", async () => {
    const f = fixture({ internet: offering({ url: ZIP, bytes: bytesOf(3000) }) });
    f.updates.start();
    f.updates.check();
    f.updates.install();
    expect(f.native.installs).toBe(0);
    await f.settled();
    await f.native.done;
    expect(f.updates.get().phase).toBe("ready");
    expect(f.pending.size).toBe(0);
    f.updates.check();
    expect(f.requests.filter((r) => r.url === FEED)).toHaveLength(1);
    f.updates.install();
    expect(f.native.installs).toBe(1);
    f.cleanup();
  });

  test("unsupported builds and blocked install paths never check or schedule", () => {
    for (const patch of [{ supported: false }, { blocked: true }]) {
      const f = fixture(patch);
      f.updates.start();
      f.updates.check();
      f.updates.setAutomatic(true);
      expect(f.requests).toHaveLength(0);
      expect(f.pending.size).toBe(0);
      f.cleanup();
    }
  });

  test("a feed that fails stays retryable, with a neutral failure and timestamp", async () => {
    const answers: Array<() => Promise<Response>> = [
      () => Promise.reject(new Error("private upstream details")),
      () => Promise.resolve(new Response("private upstream details", { status: 503 })),
      () => Promise.resolve(new Response("not json")),
    ];

    for (const internet of answers) {
      const f = fixture({ internet });
      await f.checked();
      expect(f.updates.get()).toMatchObject({
        phase: "failed",
        failure: { stage: "check", version: null },
        lastCheckedAt: 1234,
      });
      expect(JSON.stringify(f.updates.get())).not.toContain("private upstream");
      await f.checked();
      expect(f.requests).toHaveLength(2);
      f.cleanup();
    }
  });
});

test("install ID survives relaunch and is a private random UUID v4", () => {
  const home = mkdtempSync(join(tmpdir(), "polaris-install-id-"));

  try {
    const id = installId(home);
    expect(id).toMatch(/^[\da-f-]{14}4[\da-f-]{21}$/);
    expect(installId(home)).toBe(id);
    expect(readFileSync(join(home, "install-id"), "utf8").trim()).toBe(id);

    if (process.platform !== "win32")
      expect(statSync(join(home, "install-id")).mode & 0o777).toBe(0o600);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

const macLocation = (app: string, downloads: string) => cannotInstallHere(app, downloads, "darwin");

test("installation location and authoritative asset version", () => {
  expect(
    macLocation("/Users/me/Downloads/Polaris.app/Contents/Resources/app", "/Users/me/Downloads")
  ).toBe(true);
  expect(macLocation("/Volumes/Polaris/Polaris.app", "/Users/me/Downloads")).toBe(true);
  expect(
    macLocation("/private/var/folders/x/AppTranslocation/y/Polaris.app", "/Users/me/Downloads")
  ).toBe(true);
  expect(macLocation("/Users/me/Downloads-other/Polaris.app", "/Users/me/Downloads")).toBe(false);
  expect(macLocation("/Applications/Polaris.app", "/Users/me/Downloads")).toBe(false);
  expect(versionFromAsset("https://example.test/Polaris-01.2.3-arm64-mac.zip")).toBeNull();
});
