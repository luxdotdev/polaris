import { describe, expect, test } from "bun:test";
import { checksLine, firstParagraph, stalenessOf } from "./botSummary.ts";
import {
  childrenOf,
  linkOf,
  type Node,
  prepareMarkdown,
  type Properties,
  rehypeReview,
  resolvePath,
  textOf,
} from "./markdown.ts";
import { checksLabel, commentCount, cycleTab, PULL_TABS, SESSION_TABS } from "./tabs.ts";
import { filterTimeline, newSinceIndex, peopleLine, snippetOf } from "./timeline.ts";
import type { BotSummaryView, CheckRunView, TimelineItemView } from "./types.ts";

const person = (login: string, bot = false) => ({ login, bot });

const TIMELINE: ReadonlyArray<TimelineItemView> = [
  {
    kind: "push",
    id: "p1",
    at: "2026-09-29T10:00:00Z",
    url: "",
    author: person("dkato"),
    commits: [],
    forced: false,
  },
  {
    kind: "thread",
    id: "t1",
    at: "2026-09-30T10:00:00Z",
    url: "",
    threadId: "T1",
    path: "src/auth/impersonation.ts",
    line: 41,
    isResolved: false,
    isOutdated: false,
    resolvedBy: null,
    diffHunk: "@@ -38,3 +38,4 @@ start\n ctx\n ok\n+  log.info(x);",
    comments: [
      {
        id: "c1",
        author: person("suzuka", true),
        body: "Privacy",
        at: "2026-09-30T10:00:00Z",
        url: "",
      },
    ],
  },
  {
    kind: "comment",
    id: "c2",
    at: "2026-09-30T14:00:00Z",
    url: "",
    author: person("mchen"),
    body: "IP?",
  },
  {
    kind: "review",
    id: "r1",
    at: "2026-10-01T09:00:00Z",
    url: "",
    author: person("arossi"),
    state: "approved",
    body: "Thanks",
  },
  {
    kind: "review",
    id: "r2",
    at: "2026-10-01T09:30:00Z",
    url: "",
    author: person("dkato"),
    state: "commented",
    body: "",
  },
];

describe("tabs", () => {
  test("cycle wraps both ways", () => {
    expect(cycleTab(PULL_TABS, "checks", 1)).toBe("overview");
    expect(cycleTab(PULL_TABS, "overview", -1)).toBe("checks");
    expect(cycleTab(SESSION_TABS, "changes", 1)).toBe("overview");
  });

  test("counts comments, not empty reviews or pushes", () => {
    expect(commentCount(TIMELINE)).toBe(3);
  });

  const run = (
    conclusion: CheckRunView["conclusion"],
    status: CheckRunView["status"] = "completed"
  ): CheckRunView => ({
    name: "x",
    workflow: null,
    status,
    conclusion,
    startedAt: null,
    completedAt: null,
    url: null,
  });

  test("checks label", () => {
    expect(checksLabel([])).toBeNull();
    expect(checksLabel([run("success"), run("skipped")])).toBe("2 of 2 passed");
    expect(checksLabel([run("success"), run("failure")])).toBe("1 failing");
    expect(checksLabel([run(null, "in-progress"), run("success")])).toBe("1 running");
  });
});

describe("timeline", () => {
  test("filters people and bots by the thread's first author", () => {
    expect(filterTimeline(TIMELINE, "bots").map((i) => i.id)).toEqual(["t1"]);
    expect(filterTimeline(TIMELINE, "people")).toHaveLength(4);
  });

  test("people line", () => {
    expect(peopleLine(TIMELINE, 3)).toBe("3 comments from 3 people and 1 bot");
  });

  test("new since the last review", () => {
    expect(newSinceIndex(TIMELINE, "2026-09-30T12:00:00Z")).toBe(2);
    expect(newSinceIndex(TIMELINE, "2026-10-02T00:00:00Z")).toBeNull();
    expect(newSinceIndex(TIMELINE, null)).toBeNull();
  });

  test("snippet ends on the commented line, numbered", () => {
    expect(snippetOf("@@ -38,3 +38,4 @@ start\n ctx\n ok\n+  log.info(x);")).toEqual([
      { kind: "ctx", number: 39, text: "ok" },
      { kind: "add", number: 40, text: "  log.info(x);" },
    ]);
  });
});

const SUZUKA = `<!-- suzuka:summary -->
> [!WARNING]
> **Caution** — work-org/admin-console#632

Impersonation now writes audit events
on start and stop.

<details><summary>Evidence</summary>…</details>

## Deterministic Checks
typecheck passed · lint passed · tests passed · bundle passed — 2 migrations touched

| Check | Result |
|---|---|
| typecheck | passed · 41s |
`;

describe("bot summary", () => {
  test("first paragraph skips the marker and the alert", () => {
    expect(firstParagraph(SUZUKA)).toBe("Impersonation now writes audit events on start and stop.");
  });

  test("checks line", () => {
    expect(checksLine(SUZUKA)).toBe(
      "typecheck passed · lint passed · tests passed · bundle passed — 2 migrations touched"
    );
  });

  const summary = (reviewedHead: string | null): BotSummaryView => ({
    bot: "suzuka",
    commentId: "1",
    url: "",
    body: SUZUKA,
    verdict: { alert: "warning", word: "Caution" },
    reviewedHead,
    reviewedBase: null,
    updatedAt: "",
  });

  const commit = (oid: string) => ({
    oid,
    headline: "",
    body: "",
    author: null,
    at: "",
    checks: null,
  });

  test("staleness counts the commits since the reviewed head", () => {
    const commits = [commit("aaa1111"), commit("f231a8e9"), commit("3f9c02e1"), commit("7be3d1aa")];

    expect(stalenessOf(summary("f231a8e"), "7be3d1aa", commits)).toEqual({
      kind: "behind",
      commits: 2,
    });
    expect(stalenessOf(summary("7be3d1a"), "7be3d1aa", commits)).toEqual({ kind: "current" });
    expect(stalenessOf(summary(null), "7be3d1aa", commits)).toEqual({ kind: "current" });
  });
});

const el = (tagName: string, children: Array<Node>, properties: Properties = {}) => ({
  type: "element" as const,
  tagName,
  properties,
  children,
});

const t = (value: string) => ({ type: "text" as const, value });

const PATHS = ["src/auth/impersonation.ts", "src/audit/events.ts", "prisma/schema.prisma"];

const run = (tree: Node) => {
  rehypeReview(PATHS)()(tree);

  return tree;
};

describe("markdown", () => {
  test("finding links become hash links", () => {
    expect(prepareMarkdown("[Stop](finding:f-2) and [x](https://a)")).toBe(
      "[Stop](#finding=f-2) and [x](https://a)"
    );
    expect(linkOf("#finding=f-2")).toEqual({ kind: "finding", id: "f-2" });
    expect(linkOf("#path=src%2Fa.ts%3A12")).toEqual({ kind: "path", path: "src/a.ts", line: 12 });
  });

  test("resolves a path, a unique suffix, and a line", () => {
    expect(resolvePath("events.ts", PATHS)).toEqual({ path: "src/audit/events.ts", line: null });
    expect(resolvePath("src/auth/impersonation.ts:41", PATHS)).toEqual({
      path: "src/auth/impersonation.ts",
      line: 41,
    });
    expect(resolvePath("README", PATHS)).toBeNull();
  });

  test("a GitHub alert becomes a titled div", () => {
    const root = el("root", [el("blockquote", [el("p", [t("[!WARNING]\n**Caution** now")])])]);
    const alert = childrenOf(run(root))?.[0];

    expect(alert).toMatchObject({ tagName: "div", properties: { dataAlert: "warning" } });
    expect(textOf(alert ?? root)).toBe("Warning**Caution** now");
  });

  test("a diff block keeps its lines with their kind", () => {
    const root0 = el("root", []);
    const code = el("code", [t("-a\n+b\n c\n")], { className: ["language-diff"] });
    const block = childrenOf(run(el("root", [el("pre", [code])])))?.[0];

    expect(block).toMatchObject({ tagName: "div", properties: { dataDiff: "" } });
    expect(
      childrenOf(block ?? root0)?.map((l) =>
        l.type === "element" && "tagName" in l ? l.properties.dataLine : null
      )
    ).toEqual(["del", "add", "ctx"]);
  });

  test("inline code naming a changed path links into Changes", () => {
    const root = run(el("root", [el("p", [el("code", [t("events.ts")])])]));

    expect(childrenOf(childrenOf(root)?.[0] ?? root)?.[0]).toMatchObject({
      tagName: "a",
      properties: { href: "#path=src%2Faudit%2Fevents.ts" },
    });
  });

  test("a long table folds under the paragraph before it", () => {
    const rows = Array.from({ length: 12 }, () => el("tr", []));
    const table = el("table", [el("thead", []), el("tbody", rows)]);
    const root = run(el("root", [el("p", [t("Bundle budget")]), table]));

    expect(childrenOf(root)).toHaveLength(1);
    expect(textOf(childrenOf(childrenOf(root)?.[0] ?? root)?.[0] ?? root)).toBe(
      "Bundle budget · 12 rows"
    );
  });
});
