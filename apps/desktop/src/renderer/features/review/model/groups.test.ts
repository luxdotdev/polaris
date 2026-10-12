import { describe, expect, test } from "bun:test";
import { groupListRows } from "./groupList.ts";
import { groupFiles, intentSections, pathGroups } from "./groups.ts";
import { layoutRows, type ReviewFile, type ReviewSection } from "./layout.ts";

const file = (
  path: string,
  section = "pr",
  noise: Partial<Pick<ReviewFile, "generated" | "test">> = {}
): ReviewFile => ({
  key: `${section}:${path}`,
  index: 0,
  section,
  file: {
    path,
    oldPath: null,
    status: "modified",
    offset: 0,
    length: 0,
    additions: 1,
    deletions: 0,
    binary: false,
    generated: null,
  },
  fingerprint: "x",
  generated: noise.generated ?? false,
  test: noise.test ?? false,
});

const intent = (key: string, paths: ReadonlyArray<string>, critical = false) => ({
  key,
  label: key,
  summary: `Why ${key}.`,
  category: "core" as const,
  critical,
  paths,
});

describe("groups by path", () => {
  test("every file lands in one group, in the owner's order", () => {
    const files = [
      file("src/a.ts"),
      file("src/a.test.ts", "pr", { test: true }),
      file("README.md"),
      file("bun.lock", "pr", { generated: true }),
      file("package.json"),
      file("tsconfig.json"),
      file(".github/workflows/ci.yml"),
    ];

    expect(pathGroups(files).map((g) => [g.label, g.files.map((f) => f.file.path)])).toEqual([
      ["Docs", ["README.md"]],
      ["Code", ["src/a.ts"]],
      ["Tests", ["src/a.test.ts"]],
      ["Config", ["tsconfig.json", ".github/workflows/ci.yml"]],
      ["Dependencies", ["package.json"]],
      ["Generated", ["bun.lock"]],
    ]);
  });

  test("without Walkthrough groups the grouping says it is by path", () => {
    expect(groupFiles([file("a.ts")], undefined).source).toBe("path");
    expect(groupFiles([file("a.ts")], []).source).toBe("path");
  });
});

describe("groups from the Walkthrough", () => {
  test("keep its order; files it didn't name go to Other changes", () => {
    const grouping = groupFiles(
      [file("a.ts"), file("b.ts"), file("new.ts")],
      [intent("second", ["b.ts"]), intent("first", ["a.ts", "gone.ts"]), intent("empty", [])]
    );

    expect(grouping.source).toBe("walkthrough");
    expect(grouping.groups.map((g) => [g.label, g.files.map((f) => f.file.path)])).toEqual([
      ["second", ["b.ts"]],
      ["first", ["a.ts"]],
      ["Other changes", ["new.ts"]],
    ]);
  });

  test("a group's row counts viewed files, generated ones apart, and its top Severity", () => {
    const files = [file("a.ts"), file("b.ts"), file("bun.lock", "pr", { generated: true })];

    const grouping = groupFiles(files, [
      intent("code", ["a.ts", "b.ts"]),
      intent("lock", ["bun.lock"]),
    ]);

    const rows = groupListRows(
      grouping.groups,
      (f) => f.file.path === "a.ts",
      new Map([
        ["a.ts", "medium" as const],
        ["b.ts", "high" as const],
      ]),
      new Set(["intent:code"])
    );

    expect(
      rows.map((r) => {
        if (r.kind === "group") return `${r.head.group.label} ${r.head.count} ${r.head.severity}`;

        return r.kind === "summary" ? r.text : r.file.file.path;
      })
    ).toEqual(["code 1 of 2 high", "Why code.", "a.ts", "b.ts", "lock 1 generated null"]);
  });
});

describe("an Agent Session by intent", () => {
  const turn = (n: number, ...paths: ReadonlyArray<string>): ReviewSection => ({
    id: String(n),
    divider: { turn: n, harness: "claude", quote: "Go" },
    files: paths.map((p) => file(p, String(n))),
  });

  const sections = [
    turn(24, "serve.ts", "index.html", "bun.lock"),
    turn(22, "index.html", "docs.md"),
  ];

  const files = sections.flatMap((s) =>
    s.files.map((f) => ({ ...f, generated: f.file.path === "bun.lock" }))
  );

  const grouping = groupFiles(files, [
    intent("publish", ["serve.ts"], true),
    intent("layout", ["index.html"]),
    intent("docs", ["docs.md"]),
    intent("lock", ["bun.lock"]),
  ]);

  test("sections follow the groups and name the Turns their files come from", () => {
    const shown = intentSections(sections, grouping);

    const rows = layoutRows({
      sections: shown,
      scale: "full",
      viewed: (f) => f.file.path === "docs.md",
      toggled: new Map(),
      openedSections: new Set(),
      openFile: null,
    });

    expect(
      rows.flatMap((r) =>
        r.divider === null
          ? []
          : [`${r.divider.label} · ${r.divider.caption}${r.divider.folded ? " (folded)" : ""}`]
      )
    ).toEqual([
      "publish · Turn 24 · 1 file",
      "layout · Turns 22, 24 · 2 files",
      "docs · Turn 22 · 1 file · all viewed (folded)",
      "lock · Turn 24 · 1 generated (folded)",
    ]);

    expect(shown[0]?.divider?.intent?.critical).toBe(true);
  });
});
