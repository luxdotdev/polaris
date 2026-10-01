import { describe, expect, test } from "bun:test";
import { recordPick } from "./frecency.ts";
import {
  type CommandOption,
  findComplete,
  matchMenu,
  MENU_LIMIT,
  promptFor,
  sigilOpen,
} from "./commands.ts";

const option = (name: string, extra: Partial<CommandOption> = {}): CommandOption => ({
  name,
  sigil: "/",
  description: `${name} it`,
  argumentHint: null,
  kind: "skill",
  source: "user",
  plugin: null,
  run: "text",
  action: null,
  template: null,
  ...extra,
});

const OPTIONS = [
  option("simplify"),
  option("security-review"),
  option("codex:review", { source: "plugin", plugin: "codex" }),
  option("compact", { kind: "command", source: "built-in" }),
  option("model", { kind: "command", source: "built-in", run: "polaris", action: "model" }),
  option("tdd", { sigil: "$" }),
];

const names = (menu: ReturnType<typeof matchMenu>) => menu?.options.map((o) => o.name) ?? null;

describe("the / menu", () => {
  test("a bare sigil lists every command with that sigil, Skills first", () => {
    expect(names(matchMenu("/", true, OPTIONS, []))).toEqual([
      "simplify",
      "security-review",
      "codex:review",
      "compact",
      "model",
    ]);
    expect(names(matchMenu("$", false, OPTIONS, []))).toEqual(["tdd"]);
  });

  test("filters as you type: name prefixes first, then a part's prefix, then anywhere", () => {
    expect(names(matchMenu("/re", true, OPTIONS, []))).toEqual(["security-review", "codex:review"]);
    expect(names(matchMenu("/S", true, OPTIONS, []))).toEqual(["simplify", "security-review"]);
    expect(names(matchMenu("/c", true, OPTIONS, []))).toEqual(["codex:review", "compact"]);
    expect(names(matchMenu("/view", true, OPTIONS, []))).toEqual([
      "security-review",
      "codex:review",
    ]);
  });

  test("nothing matching closes it", () => {
    expect(matchMenu("/zzz", true, OPTIONS, [])).toBeNull();
    expect(matchMenu("plain", true, OPTIONS, [])).toBeNull();
  });

  test("/ only leads the message, once; $ goes anywhere", () => {
    expect(matchMenu("/", false, OPTIONS, [])).toBeNull();
    expect(matchMenu("/", true, OPTIONS, [{ sigil: "/", name: "compact" }])).toBeNull();
    expect(sigilOpen("$", false, [{ sigil: "/", name: "compact" }])).toBe(true);
  });

  test("draws at most MENU_LIMIT rows and counts the rest", () => {
    const many = Array.from({ length: MENU_LIMIT + 7 }, (_, i) => option(`skill-${i}`));
    const menu = matchMenu("/skill", true, many, []);

    expect(menu?.options).toHaveLength(MENU_LIMIT);
    expect(menu?.more).toBe(7);
  });
});

describe("typed-through chips", () => {
  const at = { startsAtBoundary: true, atHead: true };

  test("a listed name followed by a space becomes a chip", () => {
    expect(findComplete("/compact ", OPTIONS, [], at)).toMatchObject({
      option: { name: "compact" },
      start: 0,
      length: 8,
    });
    expect(findComplete("use $tdd here", OPTIONS, [], { ...at, atHead: false })).toMatchObject({
      option: { name: "tdd" },
      start: 4,
    });
  });

  test("an unknown name, a Polaris action, a path or a word not at the head stays text", () => {
    expect(findComplete("/nope ", OPTIONS, [], at)).toBeNull();
    expect(findComplete("/model ", OPTIONS, [], at)).toBeNull();
    expect(findComplete("src/compact ", OPTIONS, [], at)).toBeNull();
    expect(findComplete("please /compact ", OPTIONS, [], at)).toBeNull();
    expect(findComplete("/compact", OPTIONS, [], at)).toBeNull();
  });
});

describe("what a Turn sends", () => {
  test("chips stay as the Harness reads them", () => {
    expect(promptFor("/simplify the parser", OPTIONS)).toBe("/simplify the parser");
  });

  test("a Codex custom prompt is expanded with its arguments", () => {
    const prompts = [
      option("prompts:fix", {
        kind: "command",
        template: "Fix issue $1 carefully.\nContext: $ARGUMENTS",
      }),
    ];

    expect(promptFor("/prompts:fix 42 in the parser", prompts)).toBe(
      "Fix issue 42 carefully.\nContext: 42 in the parser"
    );
  });
});

describe("frecency in the / menu", () => {
  const NOW = Date.UTC(2026, 9, 1, 12);

  const picked = (...keys: ReadonlyArray<string>) =>
    keys.reduce((table, key) => recordPick(table, key, NOW - 60_000), {});

  test("a bare / leads with the user's frecent picks, then the rest", () => {
    const menu = matchMenu("/", true, OPTIONS, [], picked("/compact", "/compact", "/model"), NOW);

    expect(names(menu)).toEqual([
      "compact",
      "model",
      "simplify",
      "security-review",
      "codex:review",
    ]);
    expect(menu?.recent).toBe(2);
  });

  test("a pick only breaks ties: match quality still ranks first", () => {
    // "security-review" is a prefix match, "codex:review" a part's: frecency can't swap them.
    expect(names(matchMenu("/s", true, OPTIONS, [], picked("/simplify"), NOW))).toEqual([
      "simplify",
      "security-review",
    ]);
    expect(names(matchMenu("/s", true, OPTIONS, [], picked("/security-review"), NOW))).toEqual([
      "security-review",
      "simplify",
    ]);
    expect(names(matchMenu("/re", true, OPTIONS, [], picked("/codex:review"), NOW))).toEqual([
      "codex:review",
      "security-review",
    ]);
  });

  test("picks of commands the Harness no longer lists are skipped", () => {
    expect(matchMenu("/", true, OPTIONS, [], picked("/gone"), NOW)?.recent).toBe(0);
  });
});
