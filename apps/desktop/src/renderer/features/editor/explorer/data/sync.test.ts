// The app's slots first, as the app loads them: fetch.ts reaches them through the session feature.
import "../../../../app/slots.tsx";
import { beforeEach, describe, expect, test } from "bun:test";
import { GitSyncItem } from "@polaris/protocol";
import type { IpcError, PolarisApi, SubscriptionListener } from "../../../../../shared/api.ts";
import { standInBridge } from "../../../bridge.ts";
import type { Place } from "./actions.ts";
import { explorerOf, resetExplorers } from "./store.ts";
import { cancelSync, setSyncRun, startSync, syncRunOf } from "./sync.ts";

const place: Place = { key: "h\u0000w", hostKey: "h", workspaceId: "w", root: "/w" };

interface SyncInput {
  readonly hostKey: string;
  readonly cwd: string;
  readonly action: string;
}

interface Feed {
  readonly input: SyncInput;
  readonly listener: SubscriptionListener<GitSyncItem>;
  closed: boolean;
}

const FRESH_STATUS = {
  branch: "main",
  head: "abc",
  ahead: 0,
  behind: 0,
  entries: [],
  tracking: { upstream: "origin/main", gone: false, remote: null },
};

const feeds: Array<Feed> = [];

beforeEach(() => {
  feeds.length = 0;
  resetExplorers();
  setSyncRun(place.key, { kind: "idle" });

  standInBridge({
    // SAFETY: the explorer only asks for files.stat and git.status here; a refusal is a valid answer.
    request: ((method: string, input: { readonly path?: string }) => {
      if (method === "files.stat" && input.path === "/fresh/.git")
        return Promise.resolve({ ok: true, value: { kind: "directory" } });

      if (method === "git.status") return Promise.resolve({ ok: true, value: FRESH_STATUS });

      return Promise.resolve({ ok: false, error: { code: "FileError", message: "none" } });
    }) as PolarisApi["request"],
    // SAFETY: only git.sync is subscribed to in these tests.
    subscribe: ((_kind: string, input: SyncInput, listener: SubscriptionListener<GitSyncItem>) => {
      const feed: Feed = { input, listener, closed: false };

      feeds.push(feed);

      return () => {
        feed.closed = true;
      };
    }) as PolarisApi["subscribe"],
    onAppEvent: () => () => undefined,
  });
});

const feed = () => {
  const last = feeds.at(-1);

  if (last === undefined) throw new Error("no feed opened");

  return last;
};

describe("startSync", () => {
  test("follows the steps, and a failure keeps git's reason and output", () => {
    startSync(place, "sync");
    expect(feed().input).toEqual({ hostKey: "h", cwd: "/w", action: "sync" });

    feed().listener.items([GitSyncItem.cases.Step.make({ step: "push", remote: "origin" })]);
    expect(syncRunOf(place.key)).toMatchObject({ kind: "running", step: "push", remote: "origin" });

    feed().listener.items([
      GitSyncItem.cases.Failed.make({ reason: "rejected", exitCode: 1, output: "! [rejected]" }),
    ]);
    feed().listener.end?.(null);

    expect(syncRunOf(place.key)).toEqual({
      kind: "failed",
      action: "sync",
      reason: "rejected",
      exitCode: 1,
      output: "! [rejected]",
    });
  });

  test("runs one at a time per explorer", () => {
    startSync(place, "pull");
    startSync(place, "push");

    expect(feeds).toHaveLength(1);
  });

  test.each([
    ["the Host's link dropping", { code: "ConnectionLost", message: "gone" }, "lost"],
    ["git refusing outright", { code: "GitError", message: "not a git repository" }, "failed"],
  ] as const)("a feed that ends under it with %s fails as %s", (_, error: IpcError, reason) => {
    startSync(place, "pull");
    feed().listener.end?.(error);

    expect(syncRunOf(place.key)).toMatchObject({ kind: "failed", reason, output: error.message });
  });

  test("Done goes back to idle and the explorer takes the status read after it", async () => {
    const fresh: Place = {
      key: "h\u0000fresh",
      hostKey: "h",
      workspaceId: "fresh",
      root: "/fresh",
    };

    startSync(fresh, "fetch");
    feed().listener.items([GitSyncItem.cases.Done.make({})]);
    await Bun.sleep(10);

    expect(syncRunOf(fresh.key)).toEqual({ kind: "idle" });
    expect(explorerOf(fresh.key).git).toMatchObject({
      branch: "main",
      tracking: FRESH_STATUS.tracking,
    });
  });
});

describe("cancelSync", () => {
  test("closes the feed (git is killed on the Host) and reports nothing as failed", () => {
    startSync(place, "push");
    cancelSync(place);

    expect(feed().closed).toBe(true);
    expect(syncRunOf(place.key)).toEqual({ kind: "idle" });

    startSync(place, "push");
    expect(feeds).toHaveLength(2);
  });
});
