/**
 * M2-F's part of the Review preview (`#review/<scene>`): Risk Summaries for the pull request
 * and the session, threads and a pending review on #88, and the state each screenshot
 * scene opens with (a selected finding, the composer, a feedback batch). After Paper R1,
 * R6, R7 and R8.
 */
import { type RiskFinding, RiskFindingId, SessionId } from "@polaris/protocol";
import { Subjects } from "../../../commands.ts";
import type { PullDetailView, ReviewThreadView } from "../../../../shared/github.ts";
import { openComposer, setBatch } from "../../comments/data/store.ts";
import type { Summary } from "../model/summary.ts";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const PULL_KEY = "pull:work-org/nj-homes-choice-next#88";

const pending = (id: string, body: string) => ({
  id,
  author: "lucasdoell",
  body,
  createdAt: ago(3),
  url: "",
  pending: true,
});

const THREADS: ReadonlyArray<ReviewThreadView> = [
  {
    id: "T_41",
    path: "api/eligibility.ts",
    isResolved: false,
    isOutdated: false,
    anchor: { kind: "line", line: 41, startLine: null, side: "right", startSide: null },
    comments: [
      pending(
        "C_41",
        "This multiplies by 12 a second time now that the form collects annual income. Drop the * 12 here."
      ),
    ],
  },
  {
    id: "T_old",
    path: "forms/limits.test.ts",
    isResolved: false,
    isOutdated: true,
    anchor: {
      kind: "outdated",
      originalLine: 12,
      originalStartLine: null,
      side: "right",
      commitOid: "1a2b3c4",
      diffHunk:
        "@@ -8,4 +8,6 @@\n   expect(incomeLimit(2)).toBe(47_000);\n+  expect(incomeLimit(3)).toBe(53_000);",
    },
    comments: [pending("C_old", "Add the one-person case here")],
  },
];

/** #88 with a pending review: one draft on line 41 and one outdated draft. */
export const withThreads = (detail: PullDetailView): PullDetailView => ({
  ...detail,
  threads: THREADS,
  pendingReview: { id: "PRR_1", commitOid: detail.headRefOid, comments: 2 },
});

const summary = (
  id: string,
  subject: Summary["subject"],
  findings: ReadonlyArray<RiskFinding>,
  reviewer: Summary["reviewer"],
  cost: Summary["cost"]
): Summary =>
  // SAFETY: preview fixtures; the branded ids are plain strings at runtime.
  ({
    id,
    key: {
      repo: "work-org/nj-homes-choice-next",
      mergeBase: "9d81c0a4e2f1",
      head: "4f2c1a9e3b7d",
      since: null,
    },
    workspaceId: "w-nj",
    subject,
    checkoutId: null,
    status: "completed",
    layers: {
      rules: { status: "completed", note: null },
      agent: { status: "completed", note: null },
    },
    reviewer,
    cost,
    note: null,
    findings,
    startedAt: ago(2),
    endedAt: ago(1),
  }) as Summary;

export const pullSummary = (findings: ReadonlyArray<RiskFinding>) =>
  summary(
    "rs-88",
    Subjects.PullRequest({
      pullRequest: {
        repo: { host: "github.com", owner: "work-org", name: "nj-homes-choice-next" },
        number: 88,
      },
      baseRef: "nightly",
    }),
    findings,
    {
      harness: "codex",
      model: "gpt-6.1-sol",
      effort: "high",
      sessionId: SessionId.make("s-reviewer"),
    },
    { tokens: 182_400, costUsd: 0.4 }
  );

export const sessionSummary = (findings: ReadonlyArray<RiskFinding>, sessionId: string) =>
  summary(
    "rs-session",
    Subjects.SessionTurns({
      sessionId: SessionId.make(sessionId),
      firstTurnId: null,
      lastTurnId: null,
    }),
    findings,
    { harness: "claude", model: null, effort: null, sessionId: null },
    { tokens: 64_000, costUsd: 0.21 }
  );

/** Opens each scene in the state its screenshot needs; the risk column fills the rest. */
export const setUpScene = (scene: string, sessionKey: string) => {
  if (scene === "pull-comments" || scene === "pull-submit") {
    openComposer(
      PULL_KEY,
      {
        path: "api/eligibility.ts",
        side: "new",
        start: 38,
        end: 39,
        code: "  const income = form.annualIncome;\n  const limit = incomeLimit(household);",
      },
      {
        text: "Rename the parameter to annualIncome in submitEligibility’s callers too, so nobody multiplies it again",
      }
    );
  }

  if (scene === "session-feedback") {
    setBatch(sessionKey, {
      message: "",
      comments: [
        {
          id: "d-1",
          path: "prototypes/orchestrator-layout/index.html",
          lines: { start: 412, end: 412, side: "new" },
          code: "document.addEventListener('keydown', (e) => e.preventDefault());",
          note: "Don't preventDefault on every keydown; it swallows ⌘-shortcuts.",
          findingId: null,
        },
      ],
    });
    openComposer(
      sessionKey,
      {
        path: "prototypes/orchestrator-layout/serve.ts",
        side: "new",
        start: 4,
        end: 4,
        code: 'const API_TOKEN = "sk-ant-…";',
      },
      {
        text: "Read the token from the environment here too, and stop with a clear error when it’s missing",
        findingId: RiskFindingId.make("f-crit"),
      }
    );
  }
};
