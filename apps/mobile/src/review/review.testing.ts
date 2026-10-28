/** A Risk Finding for tests, open on `serve.ts` line 1 unless told otherwise. */
import { LineRange, RiskFinding, RiskFindingId } from "@polaris/protocol";

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
