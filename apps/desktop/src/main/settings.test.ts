import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { RequestInputs } from "../shared/contract.ts";
import { DEFAULT_SESSION_PREFS, isBranchPrefix } from "../shared/sessionPrefs.ts";
import { readSettings, sessionPrefsOf, type Settings } from "./settings.ts";

const file = (json: Settings) => {
  const path = join(mkdtempSync(join(tmpdir(), "polaris-settings-")), "settings.json");

  writeFileSync(path, JSON.stringify(json));

  return path;
};

describe("Settings → Sessions", () => {
  test("a file without them takes the defaults: in place, polaris/, Output and notifications on", () => {
    expect(sessionPrefsOf(readSettings(file({})))).toEqual(DEFAULT_SESSION_PREFS);
    expect(DEFAULT_SESSION_PREFS).toMatchObject({ newWorktree: false, branchPrefix: "polaris/" });
  });

  test("the old top-level newWorktree still reads; sessions wins over it", () => {
    expect(sessionPrefsOf(readSettings(file({ newWorktree: true }))).newWorktree).toBe(true);

    const both = readSettings(file({ newWorktree: true, sessions: { newWorktree: false } }));

    expect(sessionPrefsOf(both).newWorktree).toBe(false);
  });

  test("saved fields override the defaults one by one", () => {
    const settings = readSettings(file({ sessions: { branchPrefix: "", notifyNeedsYou: false } }));

    expect(sessionPrefsOf(settings)).toEqual({
      ...DEFAULT_SESSION_PREFS,
      branchPrefix: "",
      notifyNeedsYou: false,
    });
  });

  test("branch prefixes git accepts", () => {
    expect(["", "polaris/", "lucas/", "pl-", "team/agents/"].every(isBranchPrefix)).toBe(true);
    expect(["-x", "/x", "a b", "a..b", "a~", "a:", "x@{", "a\\b"].some(isBranchPrefix)).toBe(false);
  });

  test("the IPC contract refuses a prefix git wouldn't take", () => {
    const decode = Schema.decodeUnknownOption(RequestInputs["settings.setSessions"]);

    expect(decode({ patch: { branchPrefix: "lucas/" } })._tag).toBe("Some");
    expect(decode({ patch: { branchPrefix: "a b" } })._tag).toBe("None");
  });
});
