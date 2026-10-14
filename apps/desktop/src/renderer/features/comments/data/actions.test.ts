import "../../../test/dom.testing.ts";
import type { RiskFindingId, SessionId } from "@polaris/protocol";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type FakeBridge, installFakeBridge } from "../../../test/bridge.testing.ts";
import { pullDetail } from "../../../test/github.testing.ts";
import { Commands } from "../../../commands.ts";
import { standInBridge } from "../../bridge.ts";
import { reviewedStore } from "../../review/data/reviewedStore.ts";
import { surfaceOf, updateSurface } from "../../review/surface.ts";
import { emptyBatch } from "../model/feedback.ts";
import {
  addToFeedback,
  addToReview,
  commentNow,
  deleteComment,
  discardReview,
  reply,
  resolveThread,
  sendFeedback,
  sendNow,
  submitReview,
} from "./actions.ts";
import { useThreadLink } from "./links.ts";
import {
  batchOf,
  type ComposerAnchor,
  commentsStore,
  composerOf,
  openComposer,
  setBatch,
  setPullComments,
  setSessionComments,
} from "./store.ts";

const PULL = "pull:acme/atlas#7";

const SESSION = "session:s1";

const pullRef = { repo: { owner: "acme", name: "atlas" }, number: 7 };

const anchor = (patch: Partial<ComposerAnchor> = {}): ComposerAnchor => ({
  path: "src/serve.ts",
  side: "new",
  start: 12,
  end: 12,
  code: "serve()",
  ...patch,
});

let bridge: FakeBridge;

beforeEach(() => {
  bridge = installFakeBridge();
  bridge.answerOk("github.pull.detail", pullDetail());
  bridge.answerOk("github.review.addThread", { threadId: "T_1", reviewId: "R_1" });
  setPullComments(PULL, {
    pull: pullRef,
    pullId: "PR_7",
    commitOid: "head1",
    detail: null,
    settled: true,
  });
  setSessionComments(SESSION, { hostKey: "h1", sessionId: "s1", nextTurn: 3, sent: [] });
});

afterEach(() => {
  standInBridge(null);
  commentsStore.setState({ composers: {}, pulls: {}, sessions: {}, batches: {}, summaries: {} });
  reviewedStore.setState({ reviews: {} });
});

describe("adding a comment to a pull request's review", () => {
  test("a one-line comment goes on the right side at the diff's commit, then the detail is fetched again", async () => {
    openComposer(PULL, anchor(), { text: "  Why a second listener?  " });

    expect(await addToReview(PULL)).toEqual({ ok: true });
    expect(bridge.sent("github.review.addThread")).toEqual([
      {
        pull: pullRef,
        pullId: "PR_7",
        commitOid: "head1",
        path: "src/serve.ts",
        body: "Why a second listener?",
        subjectType: "line",
        line: 12,
        side: "right",
        startLine: null,
        startSide: null,
      },
    ]);
    expect(bridge.methods().at(-1)).toBe("github.pull.detail");
    expect(bridge.sent("github.pull.detail")).toEqual([
      { pull: { repo: pullRef.repo, number: 7 }, refresh: true },
    ]);
    expect(composerOf(PULL)).toBeUndefined();
    expect(surfaceOf(PULL).selection).toBeNull();
  });

  test("a range on the old side starts on the left at its first line", async () => {
    openComposer(PULL, anchor({ side: "old", start: 4, end: 9 }), { text: "Gone?" });
    await addToReview(PULL);

    expect(bridge.sent("github.review.addThread")[0]).toMatchObject({
      line: 9,
      side: "left",
      startLine: 4,
      startSide: "left",
    });
  });

  test("moving an outdated draft deletes the old comment once the new one is added", async () => {
    openComposer(PULL, anchor(), { text: "Moved here", moving: "C_old" });
    await addToReview(PULL);

    expect(bridge.methods()).toEqual([
      "github.review.addThread",
      "github.review.editComment",
      "github.pull.detail",
    ]);
    expect(bridge.sent("github.review.editComment")).toEqual([
      { pull: pullRef, commentId: "C_old", body: null },
    ]);
  });

  test("drafted from a finding, the new thread remembers it", async () => {
    // SAFETY: finding ids are branded strings; this one names the surface's finding below.
    const findingId = "F_1" as RiskFindingId;

    updateSurface(PULL, {
      // SAFETY: the link reads only a finding's id, severity and title.
      findings: [{ id: findingId, severity: "high", title: "Port reuse" }] as never,
    });
    openComposer(PULL, anchor(), { text: "See finding", findingId });
    await addToReview(PULL);

    const { result } = renderHook(() => useThreadLink("T_1"));

    expect(result.current).toEqual({ severity: "high", title: "Port reuse" });
  });

  test("GitHub refusing it keeps the composer open with its reason, and nothing is refetched", async () => {
    bridge.refuse("github.review.addThread", {
      code: "GitHubError",
      message: "CommandRejected: line is outside the diff",
    });
    openComposer(PULL, anchor(), { text: "Hmm" });

    expect(await addToReview(PULL)).toEqual({ ok: false, message: "Line is outside the diff" });
    expect(composerOf(PULL)).toMatchObject({
      text: "Hmm",
      busy: false,
      error: "Line is outside the diff",
    });
    expect(bridge.sent("github.pull.detail")).toEqual([]);
  });

  test("an empty composer sends nothing", async () => {
    openComposer(PULL, anchor(), { text: "   " });

    expect(await addToReview(PULL)).toEqual({ ok: false, message: "Write a comment first" });
    expect(bridge.calls).toEqual([]);
  });

  test("before the pull request loaded, the composer says so", async () => {
    openComposer("pull:acme/atlas#8", anchor(), { text: "Early" });

    await addToReview("pull:acme/atlas#8");

    expect(composerOf("pull:acme/atlas#8")?.error).toBe("The pull request hasn’t loaded");
    expect(bridge.calls).toEqual([]);
  });
});

describe("comment now", () => {
  test("adds the thread and publishes it as a comment review", async () => {
    openComposer(PULL, anchor(), { text: "Ship it" });

    expect(await commentNow(PULL)).toEqual({ ok: true });
    expect(bridge.methods()).toEqual([
      "github.review.addThread",
      "github.review.submit",
      "github.pull.detail",
    ]);
    expect(bridge.sent("github.review.submit")).toEqual([
      { pull: pullRef, pullId: "PR_7", event: "comment", body: "" },
    ]);
  });

  test("a refused publish leaves the error in the composer, after fetching the detail again", async () => {
    bridge.refuse("github.review.submit", { code: "GitHubError", message: "rate limited" });
    openComposer(PULL, anchor(), { text: "Ship it" });

    expect(await commentNow(PULL)).toEqual({ ok: false, message: "Rate limited" });
    expect(composerOf(PULL)?.error).toBe("Rate limited");
    expect(bridge.methods().at(-1)).toBe("github.pull.detail");
  });
});

describe("thread and review requests", () => {
  test.each([
    {
      name: "a reply, trimmed",
      run: () => reply(PULL, "T_1", " Agreed "),
      method: "github.review.reply",
      input: { pull: pullRef, pullId: "PR_7", threadId: "T_1", body: "Agreed" },
    },
    {
      name: "resolving",
      run: () => resolveThread(PULL, "T_1", true),
      method: "github.review.resolve",
      input: { pull: pullRef, threadId: "T_1", resolved: true },
    },
    {
      name: "deleting a comment",
      run: () => deleteComment(PULL, "C_2"),
      method: "github.review.editComment",
      input: { pull: pullRef, commentId: "C_2", body: null },
    },
    {
      name: "discarding the pending review",
      run: () => discardReview(PULL),
      method: "github.review.discard",
      input: { pull: pullRef, pullId: "PR_7" },
    },
  ])("$name goes to GitHub, then the detail is fetched again", async ({ run, method, input }) => {
    expect(await run()).toEqual({ ok: true });
    expect(bridge.methods()).toEqual([method, "github.pull.detail"]);
    expect(bridge.sent(method)).toEqual([input]);
  });

  test("a refusal is the result, and the detail is still fetched again", async () => {
    bridge.refuse("github.review.resolve", { code: "GitHubError", message: "thread is gone" });

    expect(await resolveThread(PULL, "T_1", false)).toEqual({
      ok: false,
      message: "Thread is gone",
    });
    expect(bridge.methods()).toEqual(["github.review.resolve", "github.pull.detail"]);
  });
});

describe("submitting a review", () => {
  test("once GitHub took it, the pull request is recorded as reviewed", async () => {
    bridge.answerOk("github.review.submit", { commitOid: "head1", at: "2026-10-13" });

    expect(await submitReview(PULL, "approve", "  LGTM ")).toEqual({ ok: true });
    expect(bridge.sent("github.review.submit")).toEqual([
      { pull: pullRef, pullId: "PR_7", event: "approve", body: "LGTM" },
    ]);
    expect(reviewedStore.getState().reviews.PR_7).toMatchObject({ commitOid: "head1" });
  });

  test("a refused submit records nothing", async () => {
    bridge.refuse("github.review.submit", {
      code: "GitHubError",
      message: "can't approve your own",
    });

    expect(await submitReview(PULL, "approve", "")).toEqual({
      ok: false,
      message: "Can't approve your own",
    });
    expect(reviewedStore.getState().reviews.PR_7).toBeUndefined();
  });
});

describe("an Agent Session's feedback", () => {
  test("adding a comment puts it in the draft batch and closes the composer", async () => {
    openComposer(SESSION, anchor({ start: 3, end: 5 }), { text: " Rename this " });

    expect(await addToFeedback(SESSION)).toEqual({ ok: true });
    expect(batchOf(SESSION).comments).toMatchObject([
      {
        path: "src/serve.ts",
        lines: { start: 3, end: 5, side: "new" },
        code: "serve()",
        note: "Rename this",
        findingId: null,
      },
    ]);
    expect(composerOf(SESSION)).toBeUndefined();
    expect(bridge.calls).toEqual([]);
  });

  test("sending dispatches one SendFeedback to the session's Host and clears the batch", async () => {
    openComposer(SESSION, anchor(), { text: "First" });
    await addToFeedback(SESSION);
    setBatch(SESSION, { ...batchOf(SESSION), message: " Please fix " });
    const { comments } = batchOf(SESSION);

    expect(await sendFeedback(SESSION)).toEqual({ ok: true });

    const [sent] = bridge.sent("dispatch");

    expect(sent?.hostKey).toBe("h1");
    expect(sent?.command).toEqual(
      Commands.SendFeedback({
        // SAFETY: the session id is the one the comments were set up with.
        sessionId: "s1" as SessionId,
        feedback: { message: "Please fix", comments },
        attachments: [],
      })
    );
    expect(batchOf(SESSION)).toEqual(emptyBatch);
  });

  test("a refused send keeps the batch", async () => {
    bridge.refuse("dispatch", { code: "CommandRejected", message: "session is archived" });
    setBatch(SESSION, { message: "Fix it", comments: [] });

    expect(await sendFeedback(SESSION)).toEqual({ ok: false, message: "Session is archived" });
    expect(batchOf(SESSION).message).toBe("Fix it");
  });

  test("an empty batch sends nothing", async () => {
    expect(await sendFeedback(SESSION)).toEqual({ ok: false, message: "Nothing to send" });
    expect(bridge.calls).toEqual([]);
  });

  test("send now sends the composer's comment with the batch", async () => {
    setBatch(SESSION, { message: "", comments: [] });
    openComposer(SESSION, anchor(), { text: "Now" });

    expect(await sendNow(SESSION)).toEqual({ ok: true });
    expect(bridge.sent("dispatch")[0]).toMatchObject({
      command: { feedback: { comments: [{ note: "Now" }] } },
    });
    expect(composerOf(SESSION)).toBeUndefined();
    expect(batchOf(SESSION)).toEqual(emptyBatch);
  });

  test("send now failing puts the batch back as it was and keeps the comment in the composer", async () => {
    setBatch(SESSION, { message: "Earlier", comments: [] });
    openComposer(SESSION, anchor(), { text: "Now" });

    const done = await sendNow(SESSION, () =>
      Promise.resolve({ ok: false, message: "Not connected" })
    );

    expect(done).toEqual({ ok: false, message: "Not connected" });
    expect(batchOf(SESSION)).toEqual({ message: "Earlier", comments: [] });
    expect(composerOf(SESSION)).toMatchObject({ text: "Now", error: "Not connected" });
  });
});
