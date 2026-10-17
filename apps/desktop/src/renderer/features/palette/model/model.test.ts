import { describe, expect, test } from "bun:test";
import type { PaletteCommand } from "../../../routes/commands.ts";
import { flatten, paletteGroups } from "./groups.ts";
import { highlighted, stepGroup, stepRow } from "./keyboard.ts";
import { loadRecents, RECENTS_KEPT, RECENTS_KEY, saveRecents, withRecent } from "./recents.ts";

const command = (
  id: string,
  title: string,
  group: PaletteCommand["group"],
  extra: Partial<PaletteCommand> = {}
): PaletteCommand => ({
  id,
  title,
  detail: "",
  group,
  keywords: [],
  shortcut: "",
  ariaKeys: "",
  followUp: false,
  searchOnly: false,
  ...extra,
});

const COMMANDS = [
  command("language.restart", "Restart TypeScript server", "file", { keywords: ["lsp"] }),
  command("typescript.selectVersion", "Select TypeScript version…", "file", { followUp: true }),
  command("editor.format", "Format document", "file"),
  command("language.restartAll", "Restart all language servers in polaris", "workspace"),
  command("trust.revoke", "Revoke trust in polaris", "workspace"),
  command("theme.toggle", "Toggle dark and light", "app", { keywords: ["theme"] }),
  command("settings.open", "Settings…", "app"),
  command("fun.stars", "Count the stars", "app", { searchOnly: true }),
];

const listing = (groups: ReturnType<typeof paletteGroups>) =>
  groups.map((g) => [g.key, g.items.map((i) => i.id)]);

describe("groups", () => {
  test("an empty query leads with Recent, then the file, the Workspace and the app", () => {
    const groups = paletteGroups({
      query: "",
      commands: COMMANDS,
      recent: ["language.restart", "gone.command", "theme.toggle"],
    });

    expect(listing(groups)).toEqual([
      ["recent", ["language.restart", "theme.toggle"]],
      ["file", ["typescript.selectVersion", "editor.format"]],
      ["workspace", ["language.restartAll", "trust.revoke"]],
      ["app", ["settings.open"]],
    ]);
  });

  test("search-only commands never list on an empty query, but their full name finds them", () => {
    const found = (query: string) =>
      flatten(paletteGroups({ query, commands: COMMANDS, recent: [] })).some(
        (c) => c.id === "fun.stars"
      );

    expect(found("")).toBe(false);
    expect(found("  Count   the STARS ")).toBe(true);
  });

  test.each(["stars", "count the", "count the star", "cnt the stars"])(
    "a search-only command stays hidden for a partial name: %p",
    (query) => {
      const shown = flatten(paletteGroups({ query, commands: COMMANDS, recent: [] }));

      expect(shown.some((c) => c.id === "fun.stars")).toBe(false);
    }
  );

  test("a recent search-only command doesn't surface in Recent", () => {
    const groups = paletteGroups({ query: "", commands: COMMANDS, recent: ["fun.stars"] });

    expect(groups[0]?.key).toBe("file");
  });

  test("fuzzy matching: a word start beats a scattered match, the best group leads", () => {
    const groups = paletteGroups({ query: "restart", commands: COMMANDS, recent: [] });

    expect(listing(groups)).toEqual([
      ["file", ["language.restart"]],
      ["workspace", ["language.restartAll"]],
    ]);

    const theme = paletteGroups({ query: "theme", commands: COMMANDS, recent: [] });

    expect(listing(theme)).toEqual([["app", ["theme.toggle"]]]);

    const scattered = paletteGroups({ query: "frmt", commands: COMMANDS, recent: [] });

    expect(flatten(scattered).map((c) => c.id)).toEqual(["editor.format"]);
  });

  test("recency breaks a tie within a group", () => {
    const groups = paletteGroups({
      query: "restart",
      commands: [command("a", "Restart one", "app"), command("b", "Restart two", "app")],
      recent: ["b"],
    });

    expect(flatten(groups).map((c) => c.id)).toEqual(["b", "a"]);
  });
});

describe("keyboard", () => {
  const sections = [
    { items: [{ id: "a" }, { id: "b" }] },
    { items: [] },
    { items: [{ id: "c" }] },
    { items: [{ id: "d" }, { id: "e" }] },
  ];

  test("↑↓ step one row and wrap", () => {
    expect(stepRow(sections, "a", 1)).toBe("b");
    expect(stepRow(sections, "b", 1)).toBe("c");
    expect(stepRow(sections, "e", 1)).toBe("a");
    expect(stepRow(sections, "a", -1)).toBe("e");
    expect(stepRow([], null, 1)).toBeNull();
  });

  test("Tab jumps to the next group's first row, ⇧Tab back, skipping empty groups", () => {
    expect(stepGroup(sections, "b", 1)).toBe("c");
    expect(stepGroup(sections, "c", 1)).toBe("d");
    expect(stepGroup(sections, "e", 1)).toBe("a");
    expect(stepGroup(sections, "a", -1)).toBe("d");
  });

  test("a highlight that left the list falls back to the first row", () => {
    expect(highlighted(sections, "gone")).toBe("a");
    expect(highlighted(sections, null)).toBe("a");
    expect(stepRow(sections, "gone", 1)).toBe("b");
  });
});

describe("recents", () => {
  const memory = () => {
    const map = new Map<string, string>();

    return {
      map,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
  };

  test("running a command moves it to the front, once, and the list stays bounded", () => {
    let recent: ReadonlyArray<string> = [];

    for (let i = 0; i < RECENTS_KEPT + 5; i++) recent = withRecent(recent, `c${i}`);
    recent = withRecent(recent, "c10");

    expect(recent[0]).toBe("c10");
    expect(recent.filter((r) => r === "c10")).toHaveLength(1);
    expect(recent).toHaveLength(RECENTS_KEPT);
  });

  test("Recent survives a restart through storage", () => {
    const storage = memory();

    saveRecents(storage, ["language.restart", "theme.toggle"]);
    expect(loadRecents(storage)).toEqual(["language.restart", "theme.toggle"]);
  });

  test("missing, corrupt or throwing storage reads as empty", () => {
    const storage = memory();

    expect(loadRecents(null)).toEqual([]);
    storage.map.set(RECENTS_KEY, "{not json");
    expect(loadRecents(storage)).toEqual([]);
    storage.map.set(RECENTS_KEY, JSON.stringify([1, 2]));
    expect(loadRecents(storage)).toEqual([]);

    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };

    expect(loadRecents(throwing)).toEqual([]);
    expect(() => saveRecents(throwing, ["a"])).not.toThrow();
  });
});
