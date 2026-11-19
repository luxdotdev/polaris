import { describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECK_INTERVAL_MS, UPDATE_BASE_URL, versionFromAsset } from "./index.ts";
import { cannotInstallHere, installId } from "./identity.ts";
import { isHttps } from "./release.ts";
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

  test("a same-size file put in the download's place during verification never reaches Squirrel", async () => {
    const asset: Asset = { url: ZIP, bytes: bytesOf(4000) };

    const f = fixture({
      internet: offering(asset),
      verify: (path) => {
        renameSync(path, `${path}.verified`);
        writeFileSync(path, bytesOf(4000).reverse());

        return Promise.resolve(true);
      },
    });

    await f.checked();
    expect(f.updates.get()).toMatchObject({
      phase: "failed",
      failure: { stage: "verify", version: "0.5.0" },
      readyVersion: null,
    });
    expect(f.native.checks).toBe(0);
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

  test("a redirect of the download is followed to https only", () => {
    expect(
      isHttps("https://release-assets.githubusercontent.com/Polaris-0.5.0-arm64-mac.zip")
    ).toBe(true);

    for (const to of ["http://github.com/a.zip", "file:///etc/passwd", "/a.zip", "not a url"])
      expect(isHttps(to)).toBe(false);
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
    expect(readdirSync(f.pendingDir)).toEqual([
      "Polaris-0.5.0-arm64-mac.zip.part",
      "Polaris-0.5.0-arm64-mac.zip.part.validator",
    ]);
    f.cleanup();
  });
});

describe("Squirrel runs one operation at a time", () => {
  const ZIP6 = ZIP.replaceAll("0.5.0", "0.6.0");

  /** Squirrel holding its report back, and the way to let it go. */
  const held = () => {
    const native = new FakeSquirrel();
    let release = () => {};

    native.hold = new Promise((resolve) => {
      release = resolve;
    });

    return { native, release };
  };

  test("a completion arriving after the timeout never passes for the newer Update's", async () => {
    const { native, release: letGo } = held();
    const five: Asset = { url: ZIP, bytes: bytesOf(3000) };
    const six: Asset = { url: ZIP6, bytes: bytesOf(4000).reverse() };
    let offered = five;

    const f = fixture(
      {
        handoverTimeoutMs: 150,
        internet: (url, init) => {
          if (url === FEED) return Promise.resolve(Response.json({ ...release, url: offered.url }));

          return Promise.resolve(serveAsset(url === ZIP ? five : six, init));
        },
      },
      native
    );

    // Squirrel reads 0.5.0 and goes quiet past the limit.
    await f.checked();
    expect(f.updates.get()).toMatchObject({
      phase: "failed",
      failure: { stage: "verify", version: "0.5.0" },
    });

    // 0.6.0 is downloaded and verified while Squirrel still holds 0.5.0.
    offered = six;
    f.updates.check();
    await until(() => f.updates.get().download?.receivedBytes === 4000);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(native.checks).toBe(1);

    const late: Array<unknown> = [];

    native.once("update-downloaded", () => {
      late.push({ ...f.updates.get(), files: readdirSync(f.pendingDir) });
    });
    letGo();
    await until(() => native.checks === 2);
    expect(late).toMatchObject([
      { phase: "downloading", readyVersion: null, files: ["Polaris-0.6.0-arm64-mac.zip"] },
    ]);

    // Only now does Squirrel get 0.6.0's feed, still open, and its own completion makes it ready.
    await f.settled();
    expect(f.updates.get()).toMatchObject({ phase: "ready", readyVersion: "0.6.0" });
    expect(native.received).toEqual(six.bytes);
    f.cleanup();
  });

  test("a Squirrel that never ends an operation holds the next Update back one timeout, no longer", async () => {
    const { native } = held();
    const asset: Asset = { url: ZIP, bytes: bytesOf(3000) };
    const f = fixture({ handoverTimeoutMs: 40, internet: offering(asset) }, native);

    await f.checked();
    expect(f.updates.get()).toMatchObject({ phase: "failed", readyVersion: null });

    // The first operation is never heard from again; the retry is handed over all the same.
    native.hold = null;
    await f.checked();
    await until(() => f.updates.get().phase === "ready");
    expect(native.checks).toBe(2);
    expect(f.updates.get()).toMatchObject({ readyVersion: "0.5.0", failure: null });
    expect(native.received).toEqual(asset.bytes);
    f.cleanup();
  });

  test.each([
    ["error", new Error("the quiet operation gave up")],
    ["update-not-available", undefined],
  ])("a late %s from the operation that went quiet leaves the retry untouched", async (...late) => {
    const first = held();
    const asset: Asset = { url: ZIP, bytes: bytesOf(3000) };
    const f = fixture({ handoverTimeoutMs: 40, internet: offering(asset) }, first.native);

    await f.checked();
    expect(f.updates.get().phase).toBe("failed");

    // The retry is handed over once the quiet operation's hold lapses; Squirrel is reading it.
    const second = held();

    first.native.hold = second.native.hold;
    f.updates.check();
    await until(() => first.native.checks === 2 && first.native.asked.length === 4);

    // The first operation's error names nothing: it must not be taken for the retry's.
    first.native.emit(...late);
    expect(f.updates.get()).toMatchObject({ phase: "downloading", failure: null });
    expect((await get(first.native.feed?.url ?? "")).status).toBe(200);

    second.release();
    await until(() => f.updates.get().phase === "ready");
    expect(f.updates.get()).toMatchObject({ readyVersion: "0.5.0", failure: null });
    f.cleanup();
  });

  test("an abandoned Update that Squirrel finishes after all, with nothing newer begun, is ready", async () => {
    const { native, release: letGo } = held();

    const f = fixture(
      { handoverTimeoutMs: 30, internet: offering({ url: ZIP, bytes: bytesOf(3000) }) },
      native
    );

    await f.checked();
    expect(f.updates.get().phase).toBe("failed");
    f.updates.install();
    expect(native.installs).toBe(0);

    letGo();
    await until(() => f.updates.get().phase === "ready");
    expect(f.updates.get()).toMatchObject({ readyVersion: "0.5.0", failure: null });
    f.cleanup();
  });

  test.each([
    "http://127.0.0.1:9/another-feed/Polaris-0.5.0-arm64-mac.zip",
    "https://github.com/luxdotdev/polaris/releases/download/v0.5.0/Polaris-0.5.0-arm64-mac.zip",
    "",
  ])("a completion naming %p instead of this feed's zip is not ready", async (claims) => {
    const native = new FakeSquirrel();
    native.claims = claims;
    const f = fixture({ internet: offering({ url: ZIP, bytes: bytesOf(3000) }) }, native);

    await f.checked();
    await native.done;
    expect(f.updates.get()).toMatchObject({
      phase: "failed",
      failure: { stage: "verify", version: "0.5.0" },
      readyVersion: null,
    });
    // The verified file stays: nothing proved Squirrel has it.
    expect(readdirSync(f.pendingDir)).toEqual(["Polaris-0.5.0-arm64-mac.zip"]);
    f.cleanup();
  });

  test("a completion for another version under this feed is not ready", async () => {
    const native = new FakeSquirrel();
    const f = fixture({ internet: offering({ url: ZIP, bytes: bytesOf(3000) }) }, native);

    native.setFeedURL = (feed) => {
      native.feed = feed;
      native.claims = feed.url.replace(/feed$/, "Polaris-0.4.9-arm64-mac.zip");
    };

    await f.checked();
    await native.done;
    expect(f.updates.get()).toMatchObject({ phase: "failed", readyVersion: null });
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

  test("busy checks are deduplicated; ready keeps checking but never downloads the same Release again", async () => {
    const f = fixture({ internet: offering({ url: ZIP, bytes: bytesOf(3000) }) });
    f.updates.start();
    f.updates.check();
    f.updates.install();
    expect(f.native.installs).toBe(0);
    await f.settled();
    await f.native.done;
    expect(f.updates.get().phase).toBe("ready");
    expect(f.requests.filter((r) => r.url === FEED)).toHaveLength(1);

    // The six-hour timer stays armed while ready, and its check finds nothing newer.
    expect(f.pending.size).toBe(1);
    f.tick();
    await until(() => f.requests.filter((r) => r.url === FEED).length === 2);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(f.requests.filter((r) => r.url === ZIP)).toHaveLength(1);
    expect(f.native.checks).toBe(1);
    expect(f.updates.get()).toMatchObject({ phase: "ready", readyVersion: "0.5.0" });
    expect(f.pending.size).toBe(1);
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
