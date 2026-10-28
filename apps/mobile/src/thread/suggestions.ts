/**
 * Suggested chips above the composer: only actions the session's state
 * already implies (DESIGN.md, Mobile App, Suggested actions), never generated
 * prompts. "Fix the critical finding" while a Critical finding is open;
 * "Open review" once the latest Turn finished.
 */
import type { RiskFinding, SessionState, TurnStatus } from "@polaris/protocol";

export type Suggestion =
  | { readonly kind: "fix"; readonly label: string; readonly finding: RiskFinding }
  | { readonly kind: "review"; readonly label: string };

export interface SuggestionContext {
  readonly state: SessionState;
  readonly lastTurn: TurnStatus | null;
  readonly findings: ReadonlyArray<RiskFinding>;
}

/** The first open Critical finding, the one the thread shows inline. */
export const openCritical = (findings: ReadonlyArray<RiskFinding>): RiskFinding | null =>
  findings.find((f) => f.severity === "critical" && f.status === "open") ?? null;

export const suggestions = (ctx: SuggestionContext): ReadonlyArray<Suggestion> => {
  const critical = openCritical(ctx.findings);
  const finished = ctx.lastTurn === "completed" && ctx.state !== "working";

  return [
    ...(critical === null
      ? []
      : [{ kind: "fix", label: "Fix the critical finding", finding: critical } as const]),
    ...(finished ? [{ kind: "review", label: "Open review" } as const] : []),
  ];
};

/** What "Fix the critical finding" puts in the composer, for the user to send. */
export const fixPrompt = (finding: RiskFinding): string =>
  `Fix the critical finding "${finding.title}" at ${finding.path}:${finding.lines.start}.`;
