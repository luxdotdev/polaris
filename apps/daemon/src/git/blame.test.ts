import { expect, test } from "bun:test";
import { parsePorcelainBlame, pathInside } from "./blame.ts";

const SHA = "a".repeat(40);

const ZERO = "0".repeat(40);

const porcelain = [
  `${SHA} 1 1 2`,
  "author Ada Lovelace",
  "author-mail <ada@example.com>",
  "author-time 1700000000",
  "author-tz +0000",
  "committer Grace Hopper",
  "committer-mail <grace@example.com>",
  "committer-time 1700000500",
  "committer-tz +0000",
  "summary Add the total",
  "filename src/a.ts",
  "\texport const total = 1;",
  `${SHA} 2 2`,
  "\t}",
  `${ZERO} 3 3 1`,
  "author Not Committed Yet",
  "author-mail <not.committed.yet>",
  "author-time 1700000900",
  "author-tz +0000",
  "committer Not Committed Yet",
  "committer-mail <not.committed.yet>",
  "committer-time 1700000900",
  "committer-tz +0000",
  "summary Version of src/a.ts from src/a.ts",
  "filename src/a.ts",
  "\tconst draft = 2;",
  "",
].join("\n");

test("each line gets its commit's fields from the commit's first line, by committer time", () => {
  const commit = {
    sha: SHA,
    subject: "Add the total",
    authorName: "Ada Lovelace",
    authorEmail: "ada@example.com",
    time: 1_700_000_500_000,
  };

  expect(parsePorcelainBlame(porcelain)).toEqual([
    { line: 1, text: "export const total = 1;", commit },
    { line: 2, text: "}", commit },
    { line: 3, text: "const draft = 2;", commit: null },
  ]);
});

test.each([
  ["/repo", "src/a.ts", "src/a.ts"],
  ["/repo", "/repo/src/a.ts", "src/a.ts"],
  ["/repo", "../etc/passwd", null],
  ["/repo", "src/../../etc/passwd", null],
  ["/repo", "src/./a.ts", "src/a.ts"],
  ["/repo", "/elsewhere/a.ts", null],
])("pathInside(%s, %s) is %s", (root, path, expected) => {
  expect(pathInside(root, path)).toBe(expected);
});
