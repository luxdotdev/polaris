/**
 * The Review contract: every new type round-trips through JSON, and what
 * older Daemons and Clients wrote (sessions, Turns, snapshots, diffs from
 * before Review) still decodes.
 */
import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { CapabilityList } from "./capabilities.ts";
import { Command, SessionPlacement } from "./commands.ts";
import { AgentSession, Turn } from "./domain.ts";
import { DomainEvent } from "./events.ts";
import {
  ReviewCheckoutId,
  RiskFindingId,
  RiskSummaryId,
  SessionId,
  TurnId,
  VerdictId,
  WorkspaceId,
} from "./ids.ts";
import {
  FeedbackBatch,
  FeedbackComment,
  feedbackPrompt,
  JudgedFinding,
  LayerRun,
  LineRange,
  PullRequestRef,
  rankFindings,
  RepoRef,
  repoKey,
  ResolvedReviewer,
  ReviewContext,
  ReviewerChoice,
  ReviewerSettings,
  ReviewCheckout,
  ReviewCheckoutBlock,
  ReviewCheckoutBlocker,
  ReviewCheckoutStatus,
  ReviewCost,
  ReviewerRun,
  ReviewSubject,
  RiskFinding,
  RiskSummary,
  RiskSummaryKey,
  RiskSummaryLayers,
  RiskSummaryRef,
  Verdict,
} from "./review.ts";
import { DiffFile, GitDiff, GitDiffSpec, HostStreamItem, RunRiskSummary } from "./rpc.ts";

const roundTrip = <A, I>(schema: Schema.Codec<A, I>, value: A) => {
  const codec = Schema.toCodecJson(schema);
  const json = JSON.stringify(Schema.encodeSync(codec)(value));

  return Schema.decodeUnknownSync(Schema.fromJsonString(codec))(json);
};

const at = "2026-10-01T00:00:00.000Z";

const repo = new RepoRef({ host: "github.com", owner: "Acme", name: "App" });

const pullRequest = new PullRequestRef({ repo, number: 42 });

const prSubject = ReviewSubject.cases.PullRequest.make({ pullRequest, baseRef: "main" });

const turnsSubject = ReviewSubject.cases.SessionTurns.make({
  sessionId: SessionId.make("s"),
  firstTurnId: null,
  lastTurnId: TurnId.make("t3"),
});

const finding = (
  id: string,
  severity: RiskFinding["severity"],
  confidence: number,
  source: RiskFinding["source"] = "agent"
) =>
  new RiskFinding({
    id: RiskFindingId.make(id),
    identity: `identity-${id}`,
    source,
    ruleId: null,
    path: "src/a.ts",
    lines: new LineRange({ start: 10, end: 12, side: "new" }),
    severity,
    confidence,
    title: "Unchecked error",
    reason: "The result of save() is ignored.",
    suggestion: "await save();",
    status: "open",
    resolution: null,
  });

const checkout = new ReviewCheckout({
  id: ReviewCheckoutId.make("rc"),
  workspaceId: WorkspaceId.make("ws"),
  subject: prSubject,
  path: "/repo.worktrees/.review/pr-42",
  state: "blocked",
  blocked: new ReviewCheckoutBlock({
    during: "remove",
    blocker: ReviewCheckoutBlocker.cases.InUse.make({
      sessionIds: [SessionId.make("s")],
      terminals: 1,
    }),
  }),
  head: "h1",
  mergeBase: "m1",
  latestHead: "h2",
  latestBase: "b1",
  reviewedHead: "h1",
  reviewedMergeBase: "m1",
  openedAt: at,
  updatedAt: at,
});

const summary = new RiskSummary({
  id: RiskSummaryId.make("sum"),
  key: new RiskSummaryKey({ repo: repoKey(repo), mergeBase: "m1", head: "h1", since: null }),
  workspaceId: WorkspaceId.make("ws"),
  subject: prSubject,
  checkoutId: checkout.id,
  status: "completed",
  layers: new RiskSummaryLayers({
    rules: new LayerRun({ status: "completed", note: null }),
    agent: new LayerRun({ status: "skipped", note: "No Reviewer is available" }),
  }),
  reviewer: new ReviewerRun({
    harness: "codex",
    model: "gpt-6.1-sol",
    effort: "high",
    sessionId: SessionId.make("reviewer"),
  }),
  cost: new ReviewCost({ tokens: 182_000, costUsd: 0.4 }),
  note: null,
  findings: [finding("f1", "high", 0.8)],
  startedAt: at,
  endedAt: at,
});

const verdict = new Verdict({
  id: VerdictId.make("v"),
  repo: repoKey(repo),
  summaryId: summary.id,
  findingId: RiskFindingId.make("f1"),
  finding: new JudgedFinding({
    identity: "identity-f1",
    source: "agent",
    ruleId: null,
    path: "src/a.ts",
    severity: "high",
    title: "Unchecked error",
  }),
  thumb: "down",
  reasons: ["intended", "other"],
  text: "We retry upstream",
  scope: "repo",
  recordedBy: "MacBook",
  recordedAt: at,
});

const feedback = new FeedbackBatch({
  message: "Two things",
  comments: [
    new FeedbackComment({
      id: "c1",
      path: "src/a.ts",
      lines: new LineRange({ start: 3, end: 3, side: "new" }),
      code: "const x = `a`;\n```",
      note: "Use a constant",
      findingId: RiskFindingId.make("f1"),
    }),
    new FeedbackComment({
      id: "c2",
      path: "src/b.ts",
      lines: new LineRange({ start: 7, end: 9, side: "old" }),
      code: "removed()",
      note: "Why was this removed?",
      findingId: null,
    }),
  ],
});

describe("Review contract", () => {
  test("every Review event round-trips", () => {
    const events = [
      DomainEvent.cases.TurnsAccepted.make({
        sessionId: SessionId.make("s"),
        throughTurnId: TurnId.make("t2"),
        throughIndex: 1,
        revertLaterTurns: true,
        acceptedBy: "MacBook",
      }),
      DomainEvent.cases.TurnsReverted.make({
        sessionId: SessionId.make("s"),
        toTurnId: TurnId.make("t2"),
        revertedTurnIds: [TurnId.make("t3")],
        checkpoint: "refs/polaris/checkpoints/s/t2/after",
      }),
      DomainEvent.cases.SessionPullRequestLinked.make({
        sessionId: SessionId.make("s"),
        pullRequest,
      }),
      DomainEvent.cases.ReviewCheckoutOpened.make({ checkout }),
      DomainEvent.cases.ReviewCheckoutChanged.make({ checkout }),
      DomainEvent.cases.ReviewCheckoutRemoved.make({
        checkoutId: checkout.id,
        workspaceId: checkout.workspaceId,
      }),
      DomainEvent.cases.RiskSummaryStarted.make({ summary }),
      DomainEvent.cases.RiskSummaryLayerChanged.make({
        summaryId: summary.id,
        layer: "agent",
        run: new LayerRun({ status: "running", note: null }),
      }),
      DomainEvent.cases.RiskFindingsRecorded.make({
        summaryId: summary.id,
        findings: [finding("f2", "critical", 1)],
      }),
      DomainEvent.cases.RiskFindingResolved.make({
        summaryId: summary.id,
        findingId: RiskFindingId.make("f2"),
        resolution: "fixed",
        note: null,
      }),
      DomainEvent.cases.RiskSummaryEnded.make({
        summaryId: summary.id,
        status: "failed",
        reviewer: null,
        cost: null,
        note: "The Reviewer exited",
      }),
      DomainEvent.cases.VerdictRecorded.make({ verdict }),
    ];

    for (const event of events) expect(roundTrip(DomainEvent, event)).toEqual(event);
  });

  test("every Review command round-trips", () => {
    const commands = [
      Command.cases.SendFeedback.make({
        sessionId: SessionId.make("s"),
        feedback,
        attachments: [],
      }),
      Command.cases.AcceptTurns.make({
        sessionId: SessionId.make("s"),
        throughTurnId: TurnId.make("t"),
        revertLaterTurns: false,
      }),
      Command.cases.LinkPullRequest.make({ sessionId: SessionId.make("s"), pullRequest }),
      Command.cases.OpenReviewCheckout.make({
        checkoutId: checkout.id,
        workspaceId: checkout.workspaceId,
        subject: turnsSubject,
        head: null,
        base: null,
      }),
      Command.cases.ReportReviewHead.make({ checkoutId: checkout.id, head: "h", base: "b" }),
      Command.cases.UpdateReviewCheckout.make({ checkoutId: checkout.id, discardChanges: true }),
      Command.cases.RemoveReviewCheckout.make({ checkoutId: checkout.id, reason: "closed" }),
      Command.cases.RecordVerdict.make({
        verdictId: verdict.id,
        summaryId: summary.id,
        findingId: verdict.findingId,
        thumb: "down",
        reasons: ["false-positive"],
        text: null,
        scope: "everywhere",
      }),
    ];

    for (const command of commands) expect(roundTrip(Command, command)).toEqual(command);
  });

  test("the RPC shapes round-trip", () => {
    const status = new ReviewCheckoutStatus({
      checkout,
      dirtyPaths: ["a.ts"],
      localCommits: 0,
      sessionsInside: [],
      terminalsInside: 0,
      diskBytes: null,
    });

    expect(roundTrip(ReviewCheckoutStatus, status)).toEqual(status);

    const byKey = RiskSummaryRef.cases.ByKey.make({ key: summary.key });
    expect(roundTrip(RiskSummaryRef, byKey)).toEqual(byKey);

    const turns = GitDiffSpec.cases.Turns.make({
      sessionId: SessionId.make("s"),
      firstTurnId: TurnId.make("t1"),
      lastTurnId: TurnId.make("t2"),
    });

    expect(roundTrip(GitDiffSpec, turns)).toEqual(turns);

    for (const blocker of [
      ReviewCheckoutBlocker.cases.Dirty.make({ paths: ["x"] }),
      ReviewCheckoutBlocker.cases.LocalCommits.make({ count: 2 }),
      ReviewCheckoutBlocker.cases.ShallowClone.make({}),
      ReviewCheckoutBlocker.cases.FetchFailed.make({ message: "Permission denied (publickey)" }),
    ]) {
      expect(roundTrip(ReviewCheckoutBlocker, blocker)).toEqual(blocker);
    }
  });

  test("the Reviewer's settings, context and placement round-trip", () => {
    const sol = ReviewerChoice.make({ harness: "codex", model: "gpt-6.1-sol", effort: "high" });

    const settings = ReviewerSettings.make({
      default: sol,
      workspaces: { "ws-1": sol },
      onPullRequests: true,
      onSessions: false,
      askAboveLines: 2000,
    });

    const resolved = ResolvedReviewer.make({ choice: null, source: "auto", note: "Rules only" });
    const context = ReviewContext.make({ title: "Fix", body: "Fixes it." });

    const placement = SessionPlacement.cases.ReviewCheckout.make({
      checkoutId: ReviewCheckoutId.make("rc-1"),
    });

    expect(roundTrip(ReviewerSettings, settings)).toEqual(settings);
    // A settings file from before "When it runs" reads with its defaults.
    expect(
      Schema.decodeUnknownSync(ReviewerSettings)({ default: null, workspaces: {} })
    ).toMatchObject({
      onPullRequests: true,
      onSessions: true,
      askAboveLines: 2000,
    });
    expect(roundTrip(ResolvedReviewer, resolved)).toEqual(resolved);
    expect(roundTrip(ReviewContext, context)).toEqual(context);
    expect(roundTrip(SessionPlacement, placement)).toEqual(placement);
  });

  test("a runRiskSummary request from before ReviewContext decodes with no context", () => {
    const codec = Schema.toCodecJson(RunRiskSummary.payloadSchema);

    const encoded = Schema.encodeSync(codec)({
      workspaceId: WorkspaceId.make("ws-1"),
      subject: summary.subject,
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

    const file = new DiffFile({
      path: "a",
      oldPath: null,
      status: "modified",
      offset: 0,
      length: 10,
      additions: 1,
      deletions: 0,
      binary: false,
    });

    expect(roundTrip(DiffFile, file)).toEqual(file);
  });

  test("an older peer drops the Review capabilities it doesn't know", () => {
    const decode = Schema.decodeUnknownSync(CapabilityList);
    expect(decode(["review.checkouts", "review.someday", "session.accept", "git.show"])).toEqual([
      "review.checkouts",
      "session.accept",
      "git.show",
    ]);
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
