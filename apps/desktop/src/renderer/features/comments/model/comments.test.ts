import { describe, expect, test } from "bun:test";
import { anchorLabel, placeLabel, sessionPlace, suggestionBlock } from "./composer.ts";
import type { PullDetailView, ReviewThreadView } from "../../../../shared/github.ts";
import {
  addDraft,
  batchCaption,
  type Draft,
  emptyBatch,
  nextTurnNumber,
  removeDraft,
  sentComments,
  toFeedback,
} from "./feedback.ts";
import {
  isDraft,
  pendingCaption,
  pendingComments,
  pendingCount,
  placeThreads,
  submitChoices,
  submitProblem,
} from "./threads.ts";

const comment = (id: string, pending: boolean) => ({
  id,
  author: "mona",
  body: `body ${id}`,
  createdAt: "2026-10-01T10:00:00Z",
  url: "",
  pending,
});

const line: ReviewThreadView = {
  id: "t1",
  path: "api/eligibility.ts",
  isResolved: false,
  isOutdated: false,
  anchor: { kind: "line", line: 39, startLine: 38, side: "right", startSide: "right" },
  comments: [comment("c1", true)],
};

const outdated: ReviewThreadView = {
  id: "t2",
  path: "forms/limits.ts",
  isResolved: false,
  isOutdated: true,
  anchor: {
    kind: "outdated",
    originalLine: 12,
    originalStartLine: null,
    side: "right",
    commitOid: "abc",
    diffHunk: "@@ -1 +1 @@",
  },
  comments: [comment("c2", true)],
};

const file: ReviewThreadView = {
  ...line,
  id: "t3",
  anchor: { kind: "file" },
  comments: [comment("c3", false)],
};

const detail = (patch: Partial<PullDetailView> = {}): PullDetailView => ({
  id: "PR_1",
  number: 88,
  title: "Eligibility",
  body: "",
  url: "",
  repo: "acme/widgets",
  state: "open",
  isDraft: false,
  author: { login: "mchen", avatarUrl: "" },
  viewerLogin: "mona",
  viewerCanApprove: true,
  headRefName: "h",
  headRefOid: "h1",
  baseRefName: "main",
  baseRefOid: "b1",
  commits: 1,
  files: [],
  threads: [line, outdated, file],
  pendingReview: { id: "R1", commitOid: "h1", comments: 2 },
  accountId: 1,
  ...patch,
});

describe("pull request threads", () => {
  test("inline, outdated and whole-file threads go to their places", () => {
    const places = placeThreads(detail().threads);

    expect(places.inline).toEqual([
      { thread: line, path: "api/eligibility.ts", side: "new", line: 39, startLine: 38 },
    ]);
    expect(places.outdated.map((t) => t.id)).toEqual(["t2"]);
    expect(places.files.map((t) => t.id)).toEqual(["t3"]);
  });

  test("a thread is a draft when the pending review starts it, not for a pending reply", () => {
    expect(isDraft(line)).toBe(true);
    expect(isDraft({ ...file, comments: [comment("c4", false), comment("c5", true)] })).toBe(false);
  });

  test("pending comments list by place", () => {
    expect(pendingComments(detail()).map((p) => p.place)).toEqual([
      "eligibility.ts:38–39",
      "limits.ts:12 (outdated)",
    ]);
    expect(pendingCount(detail())).toBe(2);
    expect(pendingCount(null)).toBe(0);
    expect(pendingCaption(3)).toBe("3 pending comments go out together");
    expect(pendingCaption(1)).toBe("1 pending comment goes out together");
  });

  test("submit choices state their consequences and GitHub's rules", () => {
    const choices = submitChoices(detail(), { severity: "high", count: 1 });

    expect(choices.map((c) => c.caption)).toEqual([
      "Feedback without a decision",
      "1 high finding is still open",
      "mchen has to address it before merging",
    ]);
    expect(choices.every((c) => c.blocked === null)).toBe(true);

    const own = submitChoices(detail({ author: { login: "mona", avatarUrl: "" } }), null);

    expect(own[1]?.blocked).not.toBeNull();
    expect(own[2]?.blocked).not.toBeNull();
    expect(submitProblem("request-changes", " ", 2)).toBe("Say what needs to change");
    expect(submitProblem("comment", "", 0)).toBe("Write a comment first");
    expect(submitProblem("comment", "", 1)).toBeNull();
  });
});

const draft = (id: string): Draft => ({
  id,
  path: "prototypes/index.html",
  lines: { start: 412, end: 412, side: "new" },
  code: "x",
  note: "Don't preventDefault on every keydown",
  findingId: null,
});

describe("Agent Session feedback", () => {
  test("the batch adds, replaces and removes drafts", () => {
    const batch = addDraft(addDraft(emptyBatch, draft("a")), draft("b"));

    expect(batch.comments.map((c) => c.id)).toEqual(["a", "b"]);
    expect(removeDraft(batch, "a").comments.map((c) => c.id)).toEqual(["b"]);
    expect(batchCaption(batch, true)).toBe("2 comments · 1 drafting");
  });

  test("sending needs a message or a comment", () => {
    expect(toFeedback(emptyBatch)).toBeNull();
    expect(toFeedback({ message: " hi ", comments: [] })).toEqual({ message: "hi", comments: [] });
    expect(toFeedback({ message: "", comments: [draft("a")] })?.message).toBeNull();
  });

  test("sent comments carry their Turn's number", () => {
    const turns = [
      { index: 0, feedback: null },
      { index: 1, feedback: { message: null, comments: [draft("a")] } },
    ];

    expect(sentComments(turns)).toEqual([{ comment: draft("a"), turnNumber: 2 }]);
    expect(nextTurnNumber(turns)).toBe(3);
    expect(nextTurnNumber([])).toBe(1);
  });
});

describe("the composer", () => {
  test("labels its range", () => {
    expect(anchorLabel({ start: 38, end: 39, side: "new" })).toBe("Lines 38–39");
    expect(anchorLabel({ start: 41, end: 41, side: "old" })).toBe("Line 41 (removed)");
    expect(placeLabel({ path: "prototypes/serve.ts", start: 7, end: 7 })).toBe("serve.ts:7");
    expect(placeLabel({ path: "index.html", start: 410, end: 412 })).toBe("index.html:410–412");
    expect(sessionPlace({ path: "a/serve.ts", start: 7, end: 7, turn: 24 })).toBe(
      "serve.ts:7 · turn 24"
    );
    expect(sessionPlace({ path: "a/serve.ts", start: 7, end: 7, turn: null })).toBe("serve.ts:7");
  });

  test("a suggestion block outlasts the code's own fences", () => {
    expect(suggestionBlock("a = 1")).toBe("```suggestion\na = 1\n```");
    expect(suggestionBlock("```js")).toBe("````suggestion\n```js\n````");
  });
});
