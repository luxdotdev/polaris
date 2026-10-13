import { describe, expect, test } from "bun:test";
import { PANE_CLASS } from "./paneLayout.ts";

describe("EditorPane layout", () => {
  test("the pane can shrink below its file, so a long file can't hide the status bar", () => {
    const classes = PANE_CLASS.split(" ");

    expect(classes).toContain("flex-1");
    expect(classes).toContain("min-h-0");
  });
});
