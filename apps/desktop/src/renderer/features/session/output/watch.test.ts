import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { standInBridge } from "../../bridge.ts";
import { type FakeBridge, installFakeBridge } from "../../../test/bridge.testing.ts";
import { acquireWatch, counts, filesTick, retryDelay, SETTLE_MS } from "./watch.ts";

describe("files.watch filter", () => {
  test("work tree edits count", () => {
    expect(counts("/repo/src/main.ts")).toBe(true);
    expect(counts("/repo/.gitignore")).toBe(true);
  });

  test("git's own writes don't, except HEAD's reflog", () => {
    expect(counts("/repo/.git/index")).toBe(false);
    expect(counts("/repo/.git/objects/ab/cdef")).toBe(false);
    expect(counts("/repo/.git/logs/HEAD")).toBe(true);
  });
});

test("a failed watch retries with backoff, capped", () => {
  expect([0, 1, 2, 3, 4, 10].map(retryDelay)).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
});

describe("the tick", () => {
  let bridge: FakeBridge;
  const releases: Array<() => void> = [];

  beforeEach(() => {
    bridge = installFakeBridge();
  });

  afterEach(() => {
    for (const release of releases.splice(0)) release();
    standInBridge(null);
  });

  test("a burst of git state changes (a git add in a terminal) bumps it once", async () => {
    releases.push(acquireWatch("host", "/repo", 1, true));
    const before = filesTick("host", "/repo");
    const feed = bridge.feeds("git.watch").find((f) => f.input.cwd === "/repo");

    feed?.listener.items([null]);
    feed?.listener.items([null, null]);
    await Bun.sleep(SETTLE_MS + 50);

    expect(filesTick("host", "/repo")).toBe(before + 1);
  });

  test("a Host without git.watch opens only the files feed", () => {
    releases.push(acquireWatch("old-host", "/repo", 1, false));

    expect(bridge.feeds("files.watch").map((f) => f.input.hostKey)).toEqual(["old-host"]);
    expect(bridge.feeds("git.watch")).toEqual([]);
  });
});
