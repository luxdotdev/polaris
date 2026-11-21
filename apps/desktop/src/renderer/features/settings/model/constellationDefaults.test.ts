import { describe, expect, test } from "bun:test";
import { DEFAULT_SESSION_PREFS } from "../../../../shared/sessionPrefs.ts";
import { inSync, selectionOf, syncLines, withUserDefaults } from "./constellationDefaults.ts";

const user = DEFAULT_SESSION_PREFS.constellationDefaults;

describe("constellation defaults on a Host", () => {
  test("a role keeps only what was chosen", () => {
    expect(selectionOf({ harness: "codex", model: "m1", effort: "high" })).toEqual({
      harness: "codex",
      model: "m1",
      effort: "high",
    });
    expect(selectionOf({ harness: "claude", model: "m2", effort: null })).toEqual({
      harness: "claude",
      model: "m2",
    });
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
      inspector: null,
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

test("the Inspector's choice is written to the Host, and clearing it returns Inspectors to the Lead's", () => {
  const host = { defaults: null, backend: null, ui: null, inspector: null };
  const chosen = { ...user, inspector: { harness: "claude" as const, model: "m3", effort: null } };
  const written = withUserDefaults(host, chosen);

  expect(written.inspector).toEqual({ harness: "claude", model: "m3" });
  expect(inSync(written, chosen)).toBe(true);
  // The Host still holds a choice the user cleared, or an older one: it must be written again.
  expect(inSync(written, user)).toBe(false);
  expect(inSync(written, { ...chosen, inspector: { ...chosen.inspector, model: "m4" } })).toBe(
    false
  );
  expect(withUserDefaults(written, user).inspector).toBeNull();
  expect(inSync(withUserDefaults(written, user), user)).toBe(true);
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
