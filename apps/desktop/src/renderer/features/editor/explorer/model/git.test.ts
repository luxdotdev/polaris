import { describe, expect, test } from "bun:test";
import { gitMarks, ignoredAt, type StatusEntry } from "./git.ts";

const entry = (path: string, xy: string): StatusEntry => ({
  path,
  origPath: null,
  index: xy[0] ?? ".",
  worktree: xy[1] ?? ".",
});

const marks = gitMarks("/repo", "/repo", [
  entry(".env", "!!"),
  entry("dist/", "!!"),
  entry("notes.md", "??"),
  entry("scratch/", "??"),
  entry("src/a.ts", ".M"),
]);

describe("ignoredAt (the git gutter shows no marks there)", () => {
  test("an ignored file, and a file inside an ignored folder", () => {
    expect(ignoredAt(marks, "/repo/.env", "/repo")).toBe(true);
    expect(ignoredAt(marks, "/repo/dist/deep/bundle.js", "/repo")).toBe(true);
  });

  test("untracked files still count as new, so they keep the added bars", () => {
    expect(ignoredAt(marks, "/repo/notes.md", "/repo")).toBe(false);
    expect(ignoredAt(marks, "/repo/scratch/idea.ts", "/repo")).toBe(false);
  });

  test("tracked and clean files are not ignored", () => {
    expect(ignoredAt(marks, "/repo/src/a.ts", "/repo")).toBe(false);
    expect(ignoredAt(marks, "/repo/src/b.ts", "/repo")).toBe(false);
  });
});
