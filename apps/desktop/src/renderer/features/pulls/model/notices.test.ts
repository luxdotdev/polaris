import { describe, expect, test } from "bun:test";
import type { PullListView } from "../../../../shared/github.ts";
import { noticesOf } from "./notices.ts";

const list = (patch: Partial<PullListView>): PullListView => ({
  requested: [],
  mine: [],
  other: [],
  repos: [],
  updatedAt: null,
  polling: "focused",
  throttledUntil: null,
  error: null,
  errorKind: null,
  ...patch,
});

const titles = (view: PullListView) =>
  noticesOf({ list: view, hostLabelOf: () => null, dismissed: new Set() }).map((n) => n.title);

describe("a failed poll's notice", () => {
  test("GitHub's failure says GitHub couldn't be reached", () => {
    expect(titles(list({ error: "fetch failed", errorKind: "github" }))).toEqual([
      "Couldn’t reach GitHub",
    ]);
  });

  test("the Keychain refusing the token says so, never as a network error", () => {
    expect(titles(list({ error: "-25308", errorKind: "keychain" }))).toEqual([
      "Polaris can’t use the macOS Keychain from this session",
    ]);
  });
});
