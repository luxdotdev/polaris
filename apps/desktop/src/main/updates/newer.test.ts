/** A newer Release replaces a ready or half-downloaded one (ENG-975). */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { UPDATE_BASE_URL } from "./index.ts";
import {
  bytesOf,
  FakeSquirrel,
  fixture,
  serveAsset,
  until,
  type Asset,
} from "./updates.testing.ts";
import { isNewer } from "./version.ts";

const FEED = `${UPDATE_BASE_URL}/api/update/darwin-arm64/0.4.0`;

const zip = (version: string) =>
  `https://github.com/luxdotdev/polaris/releases/download/v${version}/Polaris-${version}-arm64-mac.zip`;

/** The feed offers whichever Release `offer.now` names; each Release's zip is served. */
const releases = (assets: Record<string, Asset>) => {
  const offer = { now: Object.keys(assets)[0] ?? "" };

  const internet = (url: string, init: RequestInit) => {
    if (url === FEED) return Promise.resolve(Response.json({ url: zip(offer.now), name: "" }));
    const asset = Object.values(assets).find((one) => one.url === url);

    return asset === undefined
      ? Promise.reject(new Error("unexpected outbound request"))
      : Promise.resolve(serveAsset(asset, init));
  };

  return { offer, internet };
};

const asset = (version: string, patch: Partial<Asset> = {}): Asset => ({
  url: zip(version),
  bytes: bytesOf(3000 + version.length),
  ...patch,
});

/** Polaris's own copies of downloads; Squirrel has the ready one. */
const pendingFiles = (f: ReturnType<typeof fixture>) =>
  existsSync(f.pendingDir) ? readdirSync(f.pendingDir) : [];

/** Fetches of one Release's zip. */
const downloadsOf = (f: ReturnType<typeof fixture>, version: string) =>
  f.requests.filter((r) => r.url === zip(version)).length;

describe("ready → a newer Release", () => {
  test("the next check downloads it while the older stays installable, then it replaces the older", async () => {
    const six = asset("0.6.0", { bytes: bytesOf(40_000), chunk: 200, delayMs: 1 });
    const feed = releases({ "0.5.0": asset("0.5.0"), "0.6.0": six });
    const f = fixture({ internet: feed.internet });

    await f.checked();
    await until(() => f.updates.get().phase === "ready");
    expect(f.updates.get().readyVersion).toBe("0.5.0");

    // 0.6.0 is published; the six-hour timer is still armed while ready and its check finds it.
    feed.offer.now = "0.6.0";
    f.tick();
    await until(() => (f.updates.get().download?.receivedBytes ?? 0) > 0);
    expect(f.updates.get()).toMatchObject({
      phase: "downloading",
      readyVersion: "0.5.0",
      availableVersion: "0.6.0",
      replaces: "0.5.0",
      download: { version: "0.6.0" },
    });

    // Restart now installs the older Update Squirrel already has.
    f.updates.install();
    expect(f.native.installs).toBe(1);
    expect(f.native.checks).toBe(1);

    await f.settled();
    await until(() => f.updates.get().readyVersion === "0.6.0");
    expect(f.updates.get()).toMatchObject({
      phase: "ready",
      availableVersion: "0.6.0",
      download: null,
      replaces: null,
      failure: null,
    });
    expect(f.native.checks).toBe(2);
    expect(f.native.received).toEqual(six.bytes);
    expect(pendingFiles(f)).toEqual([]);
    f.cleanup();
  });

  test.each([
    ["the download drops", { dropAfter: 1000 }, "download"],
    ["Squirrel refuses it", {}, "verify"],
  ] as const)("when %s, the older Update stays ready and installable", async (_, patch, stage) => {
    const native = new FakeSquirrel();
    const feed = releases({ "0.5.0": asset("0.5.0"), "0.6.0": asset("0.6.0", { ...patch }) });
    const f = fixture({ internet: feed.internet }, native);

    await f.checked();
    await until(() => f.updates.get().phase === "ready");

    feed.offer.now = "0.6.0";
    native.rejects = stage === "verify";
    await f.checked();
    await native.done;
    expect(f.updates.get()).toMatchObject({
      phase: "ready",
      readyVersion: "0.5.0",
      download: null,
      failure: { stage, version: "0.6.0" },
    });
    f.updates.install();
    expect(native.installs).toBe(1);

    // The next check tries the newer Release again.
    native.rejects = false;
    await f.checked();
    await until(() => f.updates.get().readyVersion === "0.6.0");
    expect(f.updates.get()).toMatchObject({ phase: "ready", failure: null });
    f.cleanup();
  });

  test("a Release newer than the one downloading replaces it; the older is never handed over", async () => {
    const six = asset("0.6.0", { bytes: bytesOf(60_000), chunk: 100, delayMs: 2 });
    const seven = asset("0.7.0");
    const feed = releases({ "0.6.0": six, "0.7.0": seven });
    const f = fixture({ internet: feed.internet });

    f.updates.check();
    await until(() => (f.updates.get().download?.receivedBytes ?? 0) > 0);

    feed.offer.now = "0.7.0";
    f.updates.check();
    await until(() => f.updates.get().download?.version === "0.7.0");
    expect(f.updates.get()).toMatchObject({
      phase: "downloading",
      replaces: "0.6.0",
      readyVersion: null,
    });

    await until(() => f.updates.get().phase === "ready");
    expect(f.updates.get()).toMatchObject({ readyVersion: "0.7.0", failure: null });
    expect(f.native.checks).toBe(1);
    expect(f.native.received).toEqual(seven.bytes);
    expect(pendingFiles(f)).toEqual([]);
    f.cleanup();
  });

  test("a check that finds the Release already downloading leaves it alone", async () => {
    const six = asset("0.6.0", { bytes: bytesOf(20_000), chunk: 200, delayMs: 1 });
    const f = fixture({ internet: releases({ "0.6.0": six }).internet });

    f.updates.check();
    await until(() => (f.updates.get().download?.receivedBytes ?? 0) > 0);
    f.updates.check();
    await until(() => f.requests.filter((r) => r.url === FEED).length === 2);
    await until(() => f.updates.get().phase === "ready");
    expect(downloadsOf(f, "0.6.0")).toBe(1);
    expect(f.native.checks).toBe(1);
    f.cleanup();
  });

  test("a feed answer that arrives while Squirrel reads an Update starts nothing beside it", async () => {
    const native = new FakeSquirrel();

    let letSquirrelGo = () => {};

    let answer = () => {};

    const gate = new Promise<void>((resolve) => {
      answer = resolve;
    });

    native.hold = new Promise((resolve) => {
      letSquirrelGo = resolve;
    });
    const five = asset("0.5.0", { bytes: bytesOf(20_000), chunk: 200, delayMs: 1 });
    const feed = releases({ "0.5.0": five, "0.6.0": asset("0.6.0") });
    let asked = 0;

    const f = fixture(
      {
        internet: async (url, init) => {
          // The second check's answer is held until 0.5.0 is with Squirrel.
          if (url === FEED && ++asked === 2) await gate;

          return feed.internet(url, init);
        },
      },
      native
    );

    f.updates.check();
    await until(() => (f.updates.get().download?.receivedBytes ?? 0) > 0);
    feed.offer.now = "0.6.0";
    f.updates.check();
    await until(() => native.checks === 1);

    answer();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(downloadsOf(f, "0.6.0")).toBe(0);

    letSquirrelGo();
    await until(() => f.updates.get().phase === "ready");
    expect(f.updates.get().readyVersion).toBe("0.5.0");
    expect(native.checks).toBe(1);
    f.cleanup();
  });

  test("a Release found earlier that never became ready is named as skipped", async () => {
    const feed = releases({
      "0.5.0": asset("0.5.0", { dropAfter: 500 }),
      "0.6.0": asset("0.6.0", { bytes: bytesOf(20_000), chunk: 200, delayMs: 1 }),
    });

    const f = fixture({ internet: feed.internet });

    await f.checked();
    expect(f.updates.get()).toMatchObject({ phase: "failed", failure: { version: "0.5.0" } });

    feed.offer.now = "0.6.0";
    f.updates.check();
    await until(() => f.updates.get().download?.version === "0.6.0");
    expect(f.updates.get()).toMatchObject({ skipped: "0.5.0", replaces: null });
    await f.settled();
    f.cleanup();
  });
});

test.each([
  ["0.12.2", "0.12.1", true],
  ["0.13.0", "0.12.9", true],
  ["1.0.0", "0.99.99", true],
  ["0.12.0", "0.12.0-rc.2", true],
  ["0.12.0-rc.1", "0.12.0-beta.3", true],
  ["0.12.0-beta.10", "0.12.0-beta.9", true],
  ["0.12.1", "0.12.1", false],
  ["0.12.0", "0.12.1", false],
  ["0.12.0-rc.1", "0.12.0", false],
  ["nonsense", "0.12.0", false],
])("%s is newer than %s: %p", (version, than, newer) => {
  expect(isNewer(version, than)).toBe(newer);
});
