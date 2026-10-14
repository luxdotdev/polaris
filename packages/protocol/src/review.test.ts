/**
 * The Review contract: what older Daemons and Clients wrote (sessions, Turns,
 * snapshots, diffs from before Review) still decodes.
 */
import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { AgentSession, Turn } from "./domain.ts";
import { WorkspaceId } from "./ids.ts";
import {
  FeedbackBatch,
  feedbackPrompt,
  rankFindings,
  repoKey,
  ReviewContext,
  ReviewerSettings,
} from "./review.ts";
import { at, feedback, finding, prSubject, repo } from "./review.testing.ts";
import { DiffFile, GitDiff, HostStreamItem, RunRiskSummary } from "./rpc.ts";

describe("Review contract", () => {
  test("a Reviewer settings file from before When it runs reads with its defaults", () => {
    expect(
      Schema.decodeUnknownSync(ReviewerSettings)({ default: null, workspaces: {} })
    ).toMatchObject({
      onPullRequests: true,
      onSessions: true,
      askAboveLines: 2000,
    });
  });

  test("a runRiskSummary request from before ReviewContext decodes with no context", () => {
    const codec = Schema.toCodecJson(RunRiskSummary.payloadSchema);

    const encoded = Schema.encodeSync(codec)({
      workspaceId: WorkspaceId.make("ws-1"),
      subject: prSubject,
      checkoutId: null,
      since: null,
      refresh: false,
      context: ReviewContext.make({ title: "t", body: "b" }),
    });

    const record = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(encoded);
    const { context: _dropped, ...older } = record;

    expect(Schema.decodeUnknownSync(codec)(older).context).toBeNull();
  });

  test("sessions, Turns, Host snapshots and diffs from before Review decode with its fields empty", () => {
    const session = Schema.decodeUnknownSync(AgentSession)({
      id: "s",
      workspaceId: "ws",
      harness: "claude",
      title: "t",
      cwd: "/r",
      worktreeId: null,
      state: "idle",
      permissionMode: "supervised",
      model: null,
      parentSessionId: null,
      forkedFromTurnId: null,
      harnessCursor: null,
      turnCount: 1,
      lastError: null,
      createdAt: at,
      updatedAt: at,
    });

    expect(session.acceptedThroughIndex).toBeNull();
    expect(session.pullRequest).toBeNull();

    const turn = Schema.decodeUnknownSync(Turn)({
      id: "t",
      sessionId: "s",
      index: 0,
      prompt: "p",
      attachments: [],
      status: "completed",
      checkpointBefore: null,
      checkpointAfter: null,
      startedAt: at,
      endedAt: at,
    });

    expect(turn.feedback).toBeNull();

    const snapshot = Schema.decodeUnknownSync(Schema.fromJsonString(HostStreamItem))(
      '{"_tag":"Snapshot","sequence":3,"workspaces":[],"worktrees":[],"sessions":[]}'
    );

    expect(snapshot).toMatchObject({ reviewCheckouts: [] });

    const diff = Schema.decodeUnknownSync(GitDiff.successSchema)({
      blobId: "b",
      size: 10,
      files: 1,
    });

    expect(diff.fileIndex).toEqual([]);

    // An older Daemon doesn't say whether a file is generated: the Client decides by path.
    const file = Schema.decodeUnknownSync(Schema.fromJsonString(DiffFile))(
      '{"path":"a","oldPath":null,"status":"modified","offset":0,"length":10,' +
        '"additions":1,"deletions":0,"binary":false}'
    );

    expect(file.generated).toBeNull();
  });
});

describe("Review helpers", () => {
  test("feedbackPrompt: the message, then each comment quoted with its place and note", () => {
    expect(feedbackPrompt(feedback)).toBe(
      [
        "Two things",
        "",
        "src/a.ts:3",
        "````",
        "const x = `a`;\n```",
        "````",
        "Use a constant",
        "",
        "src/b.ts:7-9 (removed lines)",
        "```",
        "removed()",
        "```",
        "Why was this removed?",
      ].join("\n")
    );
    expect(feedbackPrompt(new FeedbackBatch({ message: null, comments: [] }))).toBe("");
  });

  test("rankFindings: Severity, then confidence, then rules before the agent", () => {
    const rule = finding("r", "high", 0.8, "rule");

    const ranked = rankFindings([
      finding("low", "low", 1),
      finding("high-unsure", "high", 0.3),
      finding("high-agent", "high", 0.8),
      rule,
      finding("critical", "critical", 0.1),
    ]);

    expect(ranked.map((f) => String(f.id))).toEqual([
      "critical",
      "r",
      "high-agent",
      "high-unsure",
      "low",
    ]);
  });

  test("repoKey ignores case", () => {
    expect(repoKey(repo)).toBe("github.com/acme/app");
  });
});
