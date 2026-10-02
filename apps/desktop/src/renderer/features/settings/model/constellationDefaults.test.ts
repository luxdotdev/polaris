import { describe, expect, test } from "bun:test";
import { DEFAULT_SESSION_PREFS } from "../../../../shared/sessionPrefs.ts";
import { inSync, selectionOf, syncLines, withUserDefaults } from "./constellationDefaults.ts";

const user = DEFAULT_SESSION_PREFS.constellationDefaults;

describe("constellation defaults on a Host", () => {
  test("a role keeps only what was chosen", () => {
    expect(selectionOf(user.backend)).toEqual({
      harness: "codex",
      model: "gpt-6.1-sol",
      effort: "high",
    });
    expect(selectionOf(user.ui)).toEqual({ harness: "claude", model: "claude-opus-5-5" });
    expect(selectionOf({ harness: "codex", model: null, effort: null })).toEqual({
      harness: "codex",
    });
  });

  test("writing keeps the Host's other settings; then it is in sync", () => {
    const host = {
      branchPrefix: "polaris",
      transfer: "origin" as const,
      claimCoalescingMs: 20_000,
      defaults: null,
      backend: null,
      ui: null,
    };

    expect(inSync(host, user)).toBe(false);

    const written = withUserDefaults(host, user);

    expect(written.transfer).toBe("origin");
    expect(written.claimCoalescingMs).toBe(20_000);
    expect(inSync(written, user)).toBe(true);
    expect(inSync(written, { ...user, ui: { harness: "codex", model: null, effort: null } })).toBe(
      false
    );
  });
});

test("where the defaults are", () => {
  expect(
    syncLines([
      { label: "Mac Studio", sync: "saved" },
      { label: "devbox", sync: "saved" },
      { label: "Raspberry Pi 4", sync: "older-daemon" },
    ])
  ).toEqual([
    "Saved on Mac Studio and devbox.",
    "Raspberry Pi 4 runs a daemon without these defaults; leads there use the built-in ones.",
  ]);
  expect(syncLines([])).toEqual([]);
});
