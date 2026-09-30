import { describe, expect, test } from "bun:test";
import { withSavedModels } from "./defaults.ts";

describe("withSavedModels", () => {
  const defaults = {
    codex: { model: "gpt-5.4", effort: "high", permissionMode: "supervised" as const },
    claude: { model: null, effort: null, permissionMode: "auto" as const },
  };

  test("the saved Model fills in where the user hasn't picked, and a pick wins", () => {
    expect(withSavedModels({}, defaults)).toEqual({ codex: { model: "gpt-5.4", effort: "high" } });
    expect(withSavedModels({ codex: { model: "o5", effort: null } }, defaults)).toEqual({
      codex: { model: "o5", effort: null },
    });
  });

  test("a Harness with no saved Model keeps the picker's default", () => {
    expect(withSavedModels({}, {})).toEqual({});
    expect("claude" in withSavedModels({}, defaults)).toBe(false);
  });
});
