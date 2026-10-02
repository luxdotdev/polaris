import { describe, expect, test } from "bun:test";
import { noAgents } from "./agents.ts";
import { changeRows } from "./changes.ts";
import { gitMarks, noMarks, statusOf } from "./git.ts";
import { foldersBetween, resolve, validName } from "./paths.ts";
import {
  type Entry,
  expandTo,
  foldersToList,
  type Listing,
  treeRows,
  type TreeInput,
} from "./tree.ts";

const ROOT = "/w";

const ready = (dir: string, names: ReadonlyArray<string>): [string, Listing] => [
  dir,
  {
    kind: "ready",
    entries: names.map((name): Entry => ({
      name: name.replace(/\/$/, ""),
      path: `${dir}/${name.replace(/\/$/, "")}`,
      kind: name.endsWith("/") ? "directory" : "file",
    })),
  },
];

const input = (overrides: Partial<TreeInput> = {}): TreeInput => ({
  root: ROOT,
  listings: new Map([
    ready(ROOT, ["package.json", "src/", "README.md", "a10.ts", "a2.ts", ".git/", "docs/"]),
    ready("/w/src", ["app/"]),
    ready("/w/src/app", ["main.ts", "view.tsx"]),
  ]),
  expanded: new Set(),
  marks: noMarks,
  agents: noAgents,
  ...overrides,
});

const labels = (i: TreeInput) => treeRows(i).map((r) => `${"  ".repeat(r.depth)}${r.label}`);

describe("statusOf", () => {
  const entry = (index: string, worktree: string) => ({
    path: "f",
    origPath: null,
    index,
    worktree,
  });

  test("letters by precedence", () => {
    expect(statusOf(entry("?", "?"))).toBe("untracked");
    expect(statusOf(entry("!", "!"))).toBe("ignored");
    expect(statusOf(entry("U", "U"))).toBe("conflicted");
    expect(statusOf(entry("A", "A"))).toBe("conflicted");
    expect(statusOf(entry("R", "M"))).toBe("renamed");
    expect(statusOf(entry(".", "D"))).toBe("deleted");
    expect(statusOf(entry("A", "M"))).toBe("added");
    expect(statusOf(entry(".", "M"))).toBe("modified");
    expect(statusOf(entry("M", "."))).toBe("modified");
  });
});

describe("gitMarks", () => {
  test("paths from the top level, folders dotted, ignored not counted", () => {
    const marks = gitMarks("/repo", "/repo/w", [
      { path: "w/src/a.ts", origPath: null, index: ".", worktree: "M" },
      { path: "w/new/", origPath: null, index: "?", worktree: "?" },
      { path: "w/dist/", origPath: null, index: "!", worktree: "!" },
      { path: "outside.ts", origPath: null, index: ".", worktree: "M" },
    ]);

    expect([...marks.files]).toEqual([
      ["/repo/w/src/a.ts", "modified"],
      ["/repo/w/new", "untracked"],
      ["/repo/w/dist", "ignored"],
    ]);
    expect([...marks.dirtyFolders]).toEqual(["/repo/w/src"]);
    expect(marks.changed).toBe(2);
  });
});

describe("treeRows", () => {
  test("folders first, natural order, .git hidden, closed by default", () => {
    expect(labels(input())).toEqual([
      "docs",
      "src/app",
      "a2.ts",
      "a10.ts",
      "package.json",
      "README.md",
    ]);
  });

  test("a chain of lone folders is one row; opening it lists the last folder", () => {
    const rows = treeRows(input({ expanded: new Set(["/w/src"]) }));

    expect(rows.map((r) => [r.label, r.depth])).toContainEqual(["main.ts", 1]);
    expect(rows.find((r) => r.label === "src/app")).toMatchObject({
      path: "/w/src/app",
      toggle: "/w/src",
      open: true,
    });
  });

  test("an open folder still listing says so", () => {
    const i = input({ expanded: new Set(["/w/docs"]) });

    expect(
      treeRows({ ...i, listings: new Map([...i.listings, ["/w/docs", { kind: "loading" }]]) })[0]
    ).toMatchObject({
      label: "docs",
      listing: "loading",
    });
  });

  test("git letters, dirty folders and deleted files stay listed", () => {
    const marks = gitMarks(ROOT, ROOT, [
      { path: "src/app/main.ts", origPath: null, index: ".", worktree: "M" },
      { path: "src/app/gone.ts", origPath: null, index: "D", worktree: "." },
    ]);

    const rows = treeRows(input({ marks, expanded: new Set(["/w/src"]) }));

    expect(rows.find((r) => r.label === "src/app")?.dirty).toBe(true);
    expect(rows.find((r) => r.label === "main.ts")?.git).toBe("modified");
    expect(rows.find((r) => r.label === "gone.ts")).toMatchObject({
      deleted: true,
      git: "deleted",
    });
  });

  test("agent dither on files; the hand on the nearest visible folder", () => {
    const agents = {
      editing: new Map([["/w/src/app/view.tsx", "codex"]]),
      blocked: new Set(["/w/src/app/main.ts", "/w/README.md"]),
    };

    const closed = treeRows(input({ agents }));

    expect(closed.find((r) => r.label === "src/app")?.hand).toBe(true);
    expect(closed.find((r) => r.label === "README.md")?.hand).toBe(true);

    const open = treeRows(input({ agents, expanded: new Set(["/w/src"]) }));

    expect(open.find((r) => r.label === "src/app")?.hand).toBe(true);
    expect(open.find((r) => r.label === "view.tsx")?.agent).toBe("codex");
    expect(open.find((r) => r.label === "main.ts")?.hand).toBe(false);
  });
});

describe("foldersToList", () => {
  test("the root and open folders only; closed ones aren't listed ahead", () => {
    const i = input({ listings: new Map([ready(ROOT, ["src/", "docs/", "x.ts"])]) });

    expect(foldersToList(i)).toEqual(["/w"]);
    expect(foldersToList({ ...i, expanded: new Set(["/w/src", "/w/docs"]) })).toEqual([
      "/w",
      "/w/docs",
      "/w/src",
    ]);
    expect(foldersToList(input({ expanded: new Set(["/w/src"]) }))).toEqual(["/w"]);
  });
});

describe("paths", () => {
  test("resolve, foldersBetween, expandTo", () => {
    expect(resolve("/w/src", "../a/./b.ts")).toBe("/w/a/b.ts");
    expect(resolve("/w", "/abs/x")).toBe("/abs/x");
    expect(foldersBetween("/w", "/w/a/b/c.ts")).toEqual(["/w/a", "/w/a/b"]);
    expect([...expandTo(new Set(), "/w", "/w/a/b/c.ts")]).toEqual(["/w/a/b", "/w/a"]);
  });

  test("validName refuses empty names and parent hops", () => {
    expect(validName("  a.ts ")).toBe("a.ts");
    expect(validName("src/new.ts")).toBe("src/new.ts");
    expect(validName("")).toBeNull();
    expect(validName("../x")).toBeNull();
    expect(validName("/x")).toBeNull();
    expect(validName("a//b")).toBeNull();
  });
});

describe("changeRows", () => {
  test("every change but ignored, by folder then name", () => {
    const marks = gitMarks(ROOT, ROOT, [
      { path: "src/b.ts", origPath: null, index: ".", worktree: "M" },
      { path: "a.ts", origPath: null, index: "?", worktree: "?" },
      { path: "dist/", origPath: null, index: "!", worktree: "!" },
    ]);

    expect(changeRows(ROOT, marks, noAgents).map((r) => [r.folder, r.name, r.git])).toEqual([
      ["", "a.ts", "untracked"],
      ["src", "b.ts", "modified"],
    ]);
  });
});
