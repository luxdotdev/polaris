import { describe, expect, test } from "bun:test";

import { ellipsisProblem } from "../../lib/menu";
import { MENU_SEPARATOR_ENTRY, type MenuEntryInput, tidyEntries } from "./menu-entries";

const item = (label: string) => ({ kind: "item", label, onSelect: () => undefined }) as const;

describe("menu entries", () => {
  test("hidden entries drop out and separators never lead, trail or double up", () => {
    const input: ReadonlyArray<MenuEntryInput> = [
      MENU_SEPARATOR_ENTRY,
      item("Open"),
      null,
      MENU_SEPARATOR_ENTRY,
      false,
      MENU_SEPARATOR_ENTRY,
      item("Copy path"),
      MENU_SEPARATOR_ENTRY,
      undefined,
    ];

    expect(tidyEntries(input).map((e) => (e.kind === "item" ? e.label : e.kind))).toEqual([
      "Open",
      "separator",
      "Copy path",
    ]);
  });

  test("the ellipsis means the command asks for more first", () => {
    expect(ellipsisProblem("Rename…", true)).toBeNull();
    expect(ellipsisProblem("Copy path", false)).toBeNull();
    expect(ellipsisProblem("Archive…", false)).not.toBeNull();
    expect(ellipsisProblem("Fork", true)).not.toBeNull();
    expect(ellipsisProblem("Fork...", true)).not.toBeNull();
  });
});
