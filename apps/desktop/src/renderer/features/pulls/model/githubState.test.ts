import { describe, expect, test } from "bun:test";
import {
  type AccountsFacts,
  EMPTY_LIST,
  emptyOf,
  githubNoticeOf,
  githubStateOf,
} from "./githubState.ts";

const accounts = (signedIn: boolean, storageAvailable = true): AccountsFacts => ({
  accounts: signedIn ? [{ state: "ok" }] : [],
  storageAvailable,
});

describe("GitHub's state on Review's list", () => {
  test("nobody signed in, with and without a keychain", () => {
    expect(githubStateOf(accounts(false), null)).toBe("signed-out");
    expect(githubStateOf(accounts(false, false), null)).toBe("no-keychain");
  });

  test("a first poll that failed is unreachable, not loading forever", () => {
    expect(githubStateOf(accounts(true), { ...EMPTY_LIST, error: "fetch failed" })).toBe(
      "unreachable"
    );
    expect(githubStateOf(accounts(true), EMPTY_LIST)).toBe("loading");
    expect(githubStateOf(accounts(true), { ...EMPTY_LIST, updatedAt: 1 })).toBe("ok");
  });
});

describe("what stands in for the groups", () => {
  test("Agent Sessions show whatever GitHub's state, with a notice when nobody is signed in", () => {
    for (const state of ["signed-out", "no-keychain", "unreachable", "loading"] as const)
      expect(emptyOf(state, 2)).toBeNull();
    expect(githubNoticeOf("signed-out", 2)).toBe("signed-out");
    expect(githubNoticeOf("no-keychain", 2)).toBe("no-keychain");
    expect(githubNoticeOf("unreachable", 2)).toBeNull();
  });

  test("with nothing to list, the empty pane says why", () => {
    expect(emptyOf("signed-out", 0)).toBe("signed-out");
    expect(emptyOf("ok", 0)).toBe("none");
    // The failed poll's notice explains it.
    expect(emptyOf("unreachable", 0)).toBeNull();
    expect(githubNoticeOf("signed-out", 0)).toBeNull();
  });
});
