/** Review values shared by the Review contract tests and the JSON round-trip table. */
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
  JudgedFinding,
  LayerRun,
  LineRange,
  PullRequestRef,
  RepoRef,
  repoKey,
  ReviewCheckout,
  ReviewCheckoutBlock,
  ReviewCheckoutBlocker,
  ReviewCost,
  ReviewerRun,
  ReviewSubject,
  RiskFinding,
  RiskSummary,
  RiskSummaryKey,
  RiskSummaryLayers,
  Verdict,
} from "./review.ts";

export const at = "2026-10-01T00:00:00.000Z";

export const repo = new RepoRef({ host: "github.com", owner: "Acme", name: "App" });

export const pullRequest = new PullRequestRef({ repo, number: 42 });

export const prSubject = ReviewSubject.cases.PullRequest.make({ pullRequest, baseRef: "main" });

export const turnsSubject = ReviewSubject.cases.SessionTurns.make({
  sessionId: SessionId.make("s"),
  firstTurnId: null,
  lastTurnId: TurnId.make("t3"),
});

export const finding = (
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

export const checkout = new ReviewCheckout({
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

export const summary = new RiskSummary({
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

export const verdict = new Verdict({
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

export const feedback = new FeedbackBatch({
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
