import { describe, expect, test } from "bun:test";
import type { PullListView, PullRowView } from "../../../shared/github.ts";
import { jumpCopy } from "./copy.ts";
import { jumpGroups } from "./groups.ts";
import { fileItems, findingItems, type JumpFinding, pullItems } from "./reviewItems.ts";

const row = (number: number, title: string): PullRowView => ({
  id: `PR_${number}`,
  number,
  title,
  url: `https://github.com/acme/widgets/pull/${number}`,
  repo: "acme/widgets",
  isDraft: false,
  author: { login: "mona", avatarUrl: "" },
  headRefName: "mona/retry",
  headRefOid: "h",
  baseRefName: "main",
  additions: 1,
  deletions: 0,
  updatedAt: "",
  reviewDecision: "review-required",
  viewerLatestReview: null,
  requestedReviewers: [],
  accountId: 1,
  workspaces: [],
});

const LIST: PullListView = {
  requested: [row(42, "Retry webhook deliveries")],
  mine: [row(43, "Document the widget lifecycle")],
  other: [row(42, "Retry webhook deliveries")],
  repos: [],
  updatedAt: null,
  polling: "idle",
  throttledUntil: null,
  error: null,
};

const finding = (id: string, severity: JumpFinding["severity"], status = "open"): JumpFinding => ({
  id,
  path: "api/eligibility.ts",
  lines: { start: 41, side: "new" },
  severity,
  title: `Finding ${id}`,
  status,
});

describe("Review in the jump menu", () => {
  test("pull requests from every list, each once, opening in Review", () => {
    const items = pullItems(LIST);

    expect(items.map((i) => [i.title, i.detail])).toEqual([
      ["Retry webhook deliveries", "#42 · acme/widgets"],
      ["Document the widget lifecycle", "#43 · acme/widgets"],
    ]);
    expect(items[0]?.target).toMatchObject({ kind: "pull", pull: { number: 42, pullId: "PR_42" } });
    expect(items[0]?.keywords).toContain("#42");
  });

  test("files by name, under their folder, each once", () => {
    const items = fileItems(["src/a.ts", "README.md", "src/a.ts"]);

    expect(items.map((i) => [i.title, i.detail])).toEqual([
      ["a.ts", "src"],
      ["README.md", ""],
    ]);
  });

  test("findings most severe first; dismissed ones only when Critical", () => {
    const items = findingItems([
      finding("m", "medium"),
      finding("c", "critical", "dismissed"),
      finding("h", "high", "dismissed"),
      finding("x", "low", "resolved"),
    ]);

    expect(items.map((i) => [i.title, i.meta, i.detail])).toEqual([
      ["Finding c", "Critical", "api/eligibility.ts:41"],
      ["Finding m", "Medium", "api/eligibility.ts:41"],
    ]);
  });

  test("Review's groups lead a search; findings show with no query", () => {
    const sources = {
      sessions: [],
      workspaces: [],
      worktrees: [],
      hosts: [],
      actions: [],
      review: {
        pulls: pullItems(LIST),
        files: fileItems(["src/webhooks/retry.ts"]),
        findings: findingItems([finding("h", "high")]),
      },
    };

    expect(jumpGroups({ query: "retry", sources, recent: [] }).map((g) => g.heading)).toEqual([
      "Pull requests",
      "Files",
    ]);
    expect(jumpGroups({ query: "", sources, recent: [] }).map((g) => g.heading)).toEqual([
      "Findings",
    ]);
  });

  test("the field says what it reaches", () => {
    expect(jumpCopy("review").placeholder).toBe("Jump to a PR, file, or finding");
    expect(jumpCopy("orchestrate").placeholder).toBe("Jump to a session or workspace");
  });
});
