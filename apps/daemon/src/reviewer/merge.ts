/**
 * "Only the new changes" as one view: an incremental Risk Summary carries
 * the previous summary's open and dismissed Findings forward, re-anchored at
 * the new head. One whose flagged code is gone is Resolved as `fixed`.
 */
import {
  DomainEvent,
  LineRange,
  RiskFinding,
  type RiskSummary,
  RiskSummaryRef,
} from "@polaris/protocol";
import { Effect } from "effect";
import { EventStore } from "../store/EventStore.ts";
import type { ReadLines } from "./output.ts";
import type { ReviewRange } from "./range.ts";

/** The newest completed summary of the head an incremental one follows; null for a full one. */
export const previousSummary = (range: ReviewRange) =>
  Effect.gen(function* () {
    const since = range.key.since;

    if (since === null) return null;
    const store = yield* EventStore;
    const summaries = yield* store.review.riskSummariesAt(range.key.repo, since, 10);

    return summaries.find((s) => s.status === "completed") ?? null;
  });

/** The Reviewer session to continue: the newest summary of that head that ran one. */
export const previousReviewerSession = (range: ReviewRange) =>
  Effect.gen(function* () {
    const since = range.key.since;

    if (since === null) return null;
    const store = yield* EventStore;
    const summaries = yield* store.review.riskSummariesAt(range.key.repo, since, 10);

    return summaries.find((s) => s.reviewer?.sessionId != null)?.reviewer?.sessionId ?? null;
  });

const normalise = (line: string) => line.replaceAll(/\s+/g, " ").trim();

/**
 * Where `block` (the flagged lines as they were) is in `lines` now: the
 * 1-based start nearest `near`, or null when it is gone.
 */
export const relocate = (
  block: ReadonlyArray<string>,
  lines: ReadonlyArray<string>,
  near: number
): number | null => {
  const wanted = block.map(normalise);

  if (wanted.every((line) => line === "")) return null;
  const have = lines.map(normalise);
  let best: number | null = null;

  for (let i = 0; i + wanted.length <= have.length; i++) {
    if (!wanted.every((line, j) => have[i + j] === line)) continue;

    if (best === null || Math.abs(i + 1 - near) < Math.abs(best - near)) best = i + 1;
  }

  return best;
};

/** The Finding at its new place, or Resolved as `fixed` when its code is gone (`start` null). */
const moved = (finding: RiskFinding, start: number | null): RiskFinding =>
  RiskFinding.make({
    id: finding.id,
    identity: finding.identity,
    source: finding.source,
    ruleId: finding.ruleId,
    path: finding.path,
    lines:
      start === null
        ? finding.lines
        : LineRange.make({
            start,
            end: start + finding.lines.end - finding.lines.start,
            side: "new",
          }),
    severity: finding.severity,
    confidence: finding.confidence,
    title: finding.title,
    reason: finding.reason,
    suggestion: finding.suggestion,
    status: start === null ? "resolved" : finding.status,
    resolution: start === null ? "fixed" : finding.resolution,
  });

/**
 * The previous summary's Findings as they stand at the new head: open and
 * dismissed ones, unless this summary found the same identity again.
 */
export const carried = Effect.fn("carried")(function* (
  previous: RiskSummary,
  current: RiskSummary,
  before: ReadLines,
  after: ReadLines
) {
  const found = new Set(current.findings.map((f) => f.identity));
  const out: Array<RiskFinding> = [];

  for (const finding of previous.findings) {
    if (finding.status === "resolved" || found.has(finding.identity)) continue;

    if (finding.lines.side === "old") {
      out.push(finding);
      continue;
    }

    const was = (yield* before(finding.path, "new")) ?? [];
    const now = yield* after(finding.path, "new");
    const block = was.slice(finding.lines.start - 1, finding.lines.end);

    out.push(moved(finding, now === null ? null : relocate(block, now, finding.lines.start)));
  }

  return out;
});

/** Records the carried Findings on the incremental summary. */
export const carryForward = (
  summary: RiskSummary,
  range: ReviewRange,
  read: { readonly before: ReadLines; readonly after: ReadLines }
) =>
  Effect.gen(function* () {
    const previous = yield* previousSummary(range);
    const store = yield* EventStore;

    const current = yield* store.review.riskSummary(
      RiskSummaryRef.cases.ById.make({ summaryId: summary.id })
    );

    if (previous === null || current === null) return 0;
    const findings = yield* carried(previous, current, read.before, read.after);

    if (findings.length > 0) {
      yield* store
        .commit({
          commandId: null,
          decide: () =>
            Effect.succeed([
              DomainEvent.cases.RiskFindingsRecorded.make({ summaryId: summary.id, findings }),
            ]),
        })
        .pipe(Effect.orDie);
    }

    return findings.length;
  });
