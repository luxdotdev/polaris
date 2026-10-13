import { describe, expect, test } from "bun:test";
import type { MergeView, ReviewersView } from "../../../../../shared/githubActions.ts";
import { checksCaption, firstMethod, keepCaption, mergeButton, mergeLeads } from "./merge.ts";

const VIEW: MergeView = {
  pullId: "PR_88",
  number: 88,
  repo: "acme/atlas",
  state: "open",
  headRefName: "lin/ship-report",
  headRefOid: "f9985e2f9985e2f9985e2f9985e2f9985e2f9985",
  baseRefName: "main",
  viewerLogin: "lin",
  viewerCanMerge: true,
  blocks: [],
  checks: { total: 6, failing: 0, pending: 0 },
  methods: ["merge", "squash", "rebase"],
  defaultMethod: "squash",
  autoMerge: { available: false, enabled: null },
  messages: {
    merge: { title: "Merge pull request #88", body: "" },
    squash: { title: "Ship the report (#88)", body: "" },
  },
  branch: { name: "lin/ship-report", keep: null },
};

const REVIEWERS: ReviewersView = {
  requested: [],
  reviewed: [],
  suggested: [],
  canRequest: true,
  author: "ada",
};

describe("the merge button", () => {
  test("hidden without write access, and once the pull request isn't open", () => {
    expect(mergeButton({ ...VIEW, viewerCanMerge: false })).toEqual({ kind: "hidden" });
    expect(mergeButton({ ...VIEW, state: "merged" })).toEqual({ kind: "hidden" });
    expect(mergeButton(null)).toEqual({ kind: "hidden" });
  });

  test("blocked says the first reason", () => {
    expect(
      mergeButton({
        ...VIEW,
        blocks: [{ kind: "checks-failing", count: 4 }, { kind: "approval-required" }],
      })
    ).toEqual({ kind: "blocked", reason: "4 checks failing" });
    expect(mergeButton({ ...VIEW, blocks: [{ kind: "draft" }] })).toEqual({
      kind: "blocked",
      reason: "draft",
    });
    expect(mergeButton({ ...VIEW, blocks: [{ kind: "conflicts" }] })).toMatchObject({
      reason: "conflicts",
    });
  });

  test("merge when ready: only running checks or reviews to come, with auto-merge available", () => {
    const pending = { ...VIEW, blocks: [{ kind: "checks-pending", count: 2 } as const] };

    expect(mergeButton(pending)).toEqual({ kind: "blocked", reason: "2 checks running" });
    expect(mergeButton({ ...pending, autoMerge: { available: true, enabled: null } })).toEqual({
      kind: "auto",
    });
    expect(
      mergeButton({
        ...VIEW,
        blocks: [{ kind: "conflicts" }],
        autoMerge: { available: true, enabled: null },
      }).kind
    ).toBe("blocked");
    expect(
      mergeButton({
        ...VIEW,
        autoMerge: { available: false, enabled: { method: "rebase", by: "lin" } },
      })
    ).toEqual({ kind: "auto-on", method: "rebase" });
  });
});

describe("merge leads the header", () => {
  test("on the viewer's own pull request, and one they approved", () => {
    expect(mergeLeads(VIEW, { ...REVIEWERS, author: "lin" })).toBe(true);
    expect(mergeLeads(VIEW, REVIEWERS)).toBe(false);
    expect(
      mergeLeads(VIEW, { ...REVIEWERS, reviewed: [{ login: "lin", state: "approved", at: null }] })
    ).toBe(true);
    expect(
      mergeLeads(VIEW, { ...REVIEWERS, reviewed: [{ login: "lin", state: "commented", at: null }] })
    ).toBe(false);
  });

  test("never while it's blocked", () => {
    expect(
      mergeLeads({ ...VIEW, blocks: [{ kind: "draft" }] }, { ...REVIEWERS, author: "lin" })
    ).toBe(false);
  });
});

describe("the popover's choices", () => {
  test("the method last used in the repository, if still allowed, else GitHub's default", () => {
    expect(firstMethod(VIEW, undefined)).toBe("squash");
    expect(firstMethod(VIEW, "rebase")).toBe("rebase");
    expect(firstMethod({ ...VIEW, methods: ["squash"] }, "rebase")).toBe("squash");
  });

  test("why the branch stays", () => {
    expect(keepCaption(null)).toBeNull();
    expect(keepCaption("default")).toContain("default branch");
    expect(keepCaption("protected")).toContain("branch rule");
    expect(keepCaption("fork")).toContain("fork");
  });

  test("checks: failing but not required is said so", () => {
    expect(checksCaption({ ...VIEW, checks: { total: 6, failing: 1, pending: 0 } })).toBe(
      "1 check failing · not required"
    );
    expect(
      checksCaption({
        ...VIEW,
        checks: { total: 6, failing: 4, pending: 0 },
        blocks: [{ kind: "checks-failing", count: 4 }],
      })
    ).toBe("4 checks failing");
    expect(checksCaption({ ...VIEW, checks: { total: 0, failing: 0, pending: 0 } })).toBeNull();
    expect(checksCaption(VIEW)).toBe("6 checks passed");
  });
});
