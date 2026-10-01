import { describe, expect, test } from "bun:test";
import {
  addVerb,
  BUILT_IN_VERBS,
  cleanVerb,
  cleanVerbs,
  MAX_VERBS,
  removeVerb,
  resolveVerbs,
  shownVerb,
  startIndex,
} from "./model.ts";

const claude = (mode: "replace" | "append", verbs: Array<string>) => ({
  mode,
  verbs,
  source: "/home/ada/.claude/settings.json",
});

describe("resolveVerbs", () => {
  test("the built-in verbs, until the user edits them", () => {
    expect(resolveVerbs({ app: null, claude: null })).toEqual(BUILT_IN_VERBS);
    expect(resolveVerbs({ app: ["Shipping"], claude: null })).toEqual(["Shipping…"]);
  });

  test("an emptied list falls back to the built-in ones", () => {
    expect(resolveVerbs({ app: [], claude: null })).toEqual(BUILT_IN_VERBS);
  });

  test("Claude Code's replace wins; append adds after the app's", () => {
    expect(resolveVerbs({ app: ["Mine"], claude: claude("replace", ["Pondering"]) })).toEqual([
      "Pondering…",
    ]);
    expect(
      resolveVerbs({ app: ["Mine"], claude: claude("append", ["Pondering", "mine"]) })
    ).toEqual(["Mine…", "Pondering…"]);
  });
});

describe("cleaning", () => {
  test("one line, trimmed, capped; an ellipsis only when it doesn't end already", () => {
    expect(cleanVerb("  Flat\n out ")).toBe("Flat out");
    expect(cleanVerb("x".repeat(100))).toHaveLength(80);
    expect(shownVerb("Pondering")).toBe("Pondering…");
    expect(shownVerb("Flat out…")).toBe("Flat out…");
    expect(shownVerb("Done...")).toBe("Done...");
  });

  test("no blanks or duplicates (ignoring case and the ellipsis), at most 50", () => {
    expect(cleanVerbs(["A", " ", "a…", "B"])).toEqual(["A", "B"]);
    expect(cleanVerbs(Array.from({ length: 80 }, (_, i) => `v${i}`))).toHaveLength(MAX_VERBS);
  });
});

describe("editing", () => {
  test("adding starts from the built-in list and skips duplicates", () => {
    expect(addVerb(null, "Shipping").at(-1)).toBe("Shipping");
    expect(addVerb(["A"], "a")).toEqual(["A"]);
    expect(addVerb(["A"], "  ")).toEqual(["A"]);
  });

  test("removing by position", () => {
    expect(removeVerb(["A", "B", "C"], 1)).toEqual(["A", "C"]);
    expect(removeVerb(null, 0)).toEqual(BUILT_IN_VERBS.slice(1));
  });

  test("a random start within the list", () => {
    expect(startIndex(5, () => 0.99)).toBe(4);
    expect(startIndex(0)).toBe(0);
  });
});
