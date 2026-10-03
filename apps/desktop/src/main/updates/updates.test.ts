import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FeedURLOptions } from "electron";
import { Schema } from "effect";
import { createAppUpdates, CHECK_INTERVAL_MS, UPDATE_BASE_URL, versionFromAsset } from "./index.ts";
import { cannotInstallHere, installId } from "./identity.ts";

class FakeUpdater extends EventEmitter {
  getFeedURL() {
    return this.feed?.url ?? "";
  }
  feed: FeedURLOptions | null = null;
  checks = 0;
  installs = 0;
  failSynchronously = false;
  setFeedURL(feed: FeedURLOptions) {
    this.feed = feed;
  }
  checkForUpdates() {
    this.checks++;

    if (this.failSynchronously) throw new Error("offline");
    this.emit("checking-for-update");
  }
  quitAndInstall() {
    this.installs++;
  }
}

const fixture = (
  patch: { supported?: boolean; blocked?: boolean; automatic?: boolean } = {},
  native = new FakeUpdater()
) => {
  const pending = new Set<() => void>();
  const saves: Array<{ automaticAppUpdates?: boolean; appUpdateLastCheckedAt?: number }> = [];
  const delays: Array<number> = [];

  const updates = createAppUpdates({
    native,
    version: "0.4.0",
    installId: "c30721f9-24ca-48e4-bdb7-eb9dd579e65b",
    macOSVersion: "26.1",
    arch: "arm64",
    supported: true,
    blocked: false,
    automatic: true,
    lastCheckedAt: null,
    ...patch,
    save: (value) => {
      saves.push(value);
    },
    publish: () => {},
    now: () => 1234,
    schedule: (run, delay) => {
      delays.push(delay);
      pending.add(run);

      return () => {
        pending.delete(run);
      };
    },
  });

  const tick = () => {
    const ready = Array.from(pending);

    for (const run of ready) {
      pending.delete(run);
      run();
    }
  };

  return { native, updates, pending, saves, delays, tick };
};

const Feed = Schema.Struct({
  url: Schema.String,
  name: Schema.String,
  notes: Schema.String,
  pub_date: Schema.String,
});

class FeedUpdater extends FakeUpdater {
  downloadedBytes: Uint8Array | null = null;
  completion: Promise<void> = Promise.resolve();
  constructor(readonly fetch: (request: Request) => Promise<Response>) {
    super();
  }
  override checkForUpdates() {
    super.checkForUpdates();
    this.completion = this.download().catch(() => {
      this.emit("error", new Error("fake feed failed"));
    });
  }
  async download() {
    if (this.feed === null) throw new Error("no feed");
    const response = await this.fetch(new Request(this.feed.url, { headers: this.feed.headers }));

    if (response.status === 204) {
      this.emit("update-not-available");

      return;
    }

    if (!response.ok) throw new Error("feed unavailable");
    const release = Schema.decodeUnknownSync(Feed)(await response.json());
    this.emit("update-available");
    const zip = await this.fetch(new Request(release.url));
    this.downloadedBytes = new Uint8Array(await zip.arrayBuffer());
    this.emit(
      "update-downloaded",
      {},
      release.notes,
      release.name,
      new Date(release.pub_date),
      release.url
    );
  }
}

test("fake feed: GET 204, Release JSON, background ZIP download and apply", async () => {
  const zipURL =
    "https://github.com/luxdotdev/polaris/releases/download/v0.5.0/Polaris-0.5.0-arm64-mac.zip";

  const requests: Array<Request> = [];
  let offerUpdate = false;

  const native = new FeedUpdater(async (request) => {
    requests.push(request);

    if (request.url === zipURL) return new Response(new Uint8Array([80, 75, 3, 4]));

    if (request.url !== `${UPDATE_BASE_URL}/api/update/darwin-arm64/0.4.0`)
      throw new Error("unexpected outbound request");
    expect(request.method).toBe("GET");

    return offerUpdate
      ? Response.json({
          url: zipURL,
          name: "Release title",
          notes: "notes",
          pub_date: "2026-10-02T00:00:00Z",
        })
      : new Response(null, { status: 204 });
  });

  const { updates } = fixture({}, native);
  updates.start();
  await native.completion;
  expect(updates.get().phase).toBe("current");
  expect(requests[0]?.headers.get("X-Polaris-Install-ID")).toBe(updates.get().installId);
  offerUpdate = true;
  updates.setAutomatic(false);
  updates.check();
  await native.completion;
  expect(requests[1]?.headers.get("X-Polaris-Install-ID")).toBeNull();
  expect(requests[1]?.headers.get("X-Polaris-macOS-Version")).toBe("26.1");
  expect(native.downloadedBytes).toEqual(new Uint8Array([80, 75, 3, 4]));
  expect(updates.get().availableVersion).toBe("0.5.0");
  expect(updates.get().phase).toBe("ready");
  updates.install();
  expect(native.installs).toBe(1);
  updates.dispose();
});

describe("Desktop App Updates", () => {
  test("packaged supported launch checks once; one six-hour timer, then disposal", () => {
    const { native, updates, pending, delays, tick } = fixture();
    updates.start();
    expect(native.checks).toBe(1);
    expect(pending.size).toBe(1);
    expect(delays).toEqual([CHECK_INTERVAL_MS]);
    native.emit("update-not-available");
    expect(updates.get().phase).toBe("current");
    expect(updates.get().lastCheckedAt).toBe(1234);
    tick();
    expect(native.checks).toBe(2);
    expect(pending.size).toBe(1);
    updates.dispose();
    expect(pending.size).toBe(0);
    expect(native.listenerCount("update-downloaded")).toBe(0);
  });

  test("off stops automatic requests and ID; Check now still works, re-enable persists", () => {
    const { native, updates, pending, saves } = fixture({ automatic: false });
    updates.start();
    expect(native.checks).toBe(0);
    expect(pending.size).toBe(0);
    updates.check();
    expect(native.feed).toEqual({
      url: `${UPDATE_BASE_URL}/api/update/darwin-arm64/0.4.0`,
      headers: { "X-Polaris-macOS-Version": "26.1" },
    });
    native.emit("update-not-available");
    updates.setAutomatic(true);
    updates.check();
    expect(native.feed?.headers?.["X-Polaris-Install-ID"]).toBe(updates.get().installId);
    updates.setAutomatic(false);
    expect(pending.size).toBe(0);
    expect(saves).toContainEqual({ automaticAppUpdates: false });
    native.emit("update-not-available");
    updates.check();
    expect(native.feed?.headers).not.toHaveProperty("X-Polaris-Install-ID");
    updates.dispose();
  });

  test("busy/ready checks are deduplicated; no install until downloaded", () => {
    const { native, updates, pending } = fixture();
    updates.start();
    updates.check();
    updates.install();
    expect(native.checks).toBe(1);
    expect(native.installs).toBe(0);
    native.emit("update-available");
    updates.check();
    expect(updates.get().phase).toBe("downloading");
    expect(updates.get().availableVersion).toBeNull();
    native.emit(
      "update-downloaded",
      {},
      "notes",
      "September release",
      new Date(),
      "https://github.com/luxdotdev/polaris/releases/download/v0.5.0/Polaris-0.5.0-arm64-mac.zip"
    );
    expect(updates.get().phase).toBe("ready");
    expect(updates.get().availableVersion).toBe("0.5.0");
    expect(pending.size).toBe(0);
    updates.check();
    expect(native.checks).toBe(1);
    updates.install();
    expect(native.installs).toBe(1);
    updates.dispose();
  });

  test("unsupported builds and blocked install paths never check or schedule", () => {
    for (const patch of [{ supported: false }, { blocked: true }]) {
      const { native, updates, pending } = fixture(patch);
      updates.start();
      updates.check();
      updates.setAutomatic(true);
      expect(native.checks).toBe(0);
      expect(pending.size).toBe(0);
      updates.dispose();
    }
  });

  test("native errors remain retryable, with a neutral failure and timestamp", () => {
    const { native, updates } = fixture();
    updates.check();
    native.emit("error", new Error("private upstream details"));
    expect(updates.get().phase).toBe("failed");
    expect(JSON.stringify(updates.get())).not.toContain("private upstream");
    native.failSynchronously = true;
    updates.check();
    expect(updates.get().phase).toBe("failed");
    expect(native.checks).toBe(2);
    updates.dispose();
  });
});

test("install ID survives relaunch and is a private random UUID v4", () => {
  const home = mkdtempSync(join(tmpdir(), "polaris-install-id-"));

  try {
    const id = installId(home);
    expect(id).toMatch(/^[\da-f-]{14}4[\da-f-]{21}$/);
    expect(installId(home)).toBe(id);
    expect(readFileSync(join(home, "install-id"), "utf8").trim()).toBe(id);
    expect(statSync(join(home, "install-id")).mode & 0o777).toBe(0o600);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("installation location and authoritative asset version", () => {
  expect(
    cannotInstallHere(
      "/Users/me/Downloads/Polaris.app/Contents/Resources/app",
      "/Users/me/Downloads"
    )
  ).toBe(true);
  expect(cannotInstallHere("/Volumes/Polaris/Polaris.app", "/Users/me/Downloads")).toBe(true);
  expect(
    cannotInstallHere(
      "/private/var/folders/x/AppTranslocation/y/Polaris.app",
      "/Users/me/Downloads"
    )
  ).toBe(true);
  expect(cannotInstallHere("/Users/me/Downloads-other/Polaris.app", "/Users/me/Downloads")).toBe(
    false
  );
  expect(cannotInstallHere("/Applications/Polaris.app", "/Users/me/Downloads")).toBe(false);
  expect(versionFromAsset("https://example.test/Polaris-01.2.3-arm64-mac.zip")).toBeNull();
});
