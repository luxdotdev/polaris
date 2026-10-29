import { describe, expect, test } from "bun:test";
import { mentionRows, mentionText } from "./mentions.ts";

const PATHS = ["src/components/Button.tsx", "src/app.ts", "./docs/components.md"];

describe("the @ picker's rows", () => {
  test("folders whose name matches lead, from the files found; then the files", () => {
    expect(mentionRows("comp", PATHS).map((r) => r.path)).toEqual([
      "src/components/",
      "src/components/Button.tsx",
      "src/app.ts",
      "docs/components.md",
    ]);
  });

  test("with a / the query matches a folder's path, so src/c narrows inside src", () => {
    expect(
      mentionRows("src/c", PATHS)
        .filter((r) => r.kind === "folder")
        .map((r) => r.path)
    ).toEqual(["src/components/"]);
  });
});

test("a mention is sent as @path, quoted when the path has spaces (Claude Code's form)", () => {
  expect(mentionText("src/app.ts")).toBe("@src/app.ts");
  expect(mentionText("docs/my notes.md")).toBe('@"docs/my notes.md"');
});
