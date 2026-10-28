/** Risk Findings and Risk Summaries for tests: a finding is open on `serve.ts` line 1 unless told otherwise. */
import {
  LayerRun,
  LineRange,
  ReviewSubject,
  RiskFinding,
  RiskFindingId,
  RiskSummary,
  RiskSummaryId,
  RiskSummaryKey,
  RiskSummaryLayers,
  SessionId,
  WorkspaceId,
} from "@polaris/protocol";

export const finding = (
  id: string,
  severity: RiskFinding["severity"],
  options: Partial<{
    status: RiskFinding["status"];
    path: string;
    line: number;
    side: "new" | "old";
    confidence: number;
  }> = {}
) =>
  new RiskFinding({
    id: RiskFindingId.make(id),
    identity: id,
    source: "rule",
    ruleId: null,
    path: options.path ?? "serve.ts",
    lines: new LineRange({
      start: options.line ?? 1,
      end: options.line ?? 1,
      side: options.side ?? "new",
    }),
    severity,
    confidence: options.confidence ?? 0.9,
    title: `${severity} ${id}`,
    reason: "because",
    suggestion: null,
    status: options.status ?? "open",
    resolution: null,
  });

/** A session Turn's Risk Summary with `findings`, in `status`. */
export const summary = (
  status: RiskSummary["status"],
  findings: ReadonlyArray<RiskFinding> = [],
  note: string | null = null
) =>
  new RiskSummary({
    id: RiskSummaryId.make("summary"),
    key: new RiskSummaryKey({
      repo: "/w",
      mergeBase: "a".repeat(40),
      head: "b".repeat(40),
      since: null,
    }),
    workspaceId: WorkspaceId.make("workspace"),
    subject: ReviewSubject.cases.SessionTurns.make({
      sessionId: SessionId.make("session"),
      firstTurnId: null,
      lastTurnId: null,
    }),
    checkoutId: null,
    status,
    layers: new RiskSummaryLayers({
      rules: new LayerRun({ status: status === "running" ? "running" : "completed", note: null }),
      agent: new LayerRun({ status: status === "running" ? "running" : "completed", note: null }),
    }),
    reviewer: null,
    cost: null,
    note,
    findings,
    startedAt: "2026-10-27T10:00:00.000Z",
    endedAt: status === "running" ? null : "2026-10-27T10:01:00.000Z",
  });
