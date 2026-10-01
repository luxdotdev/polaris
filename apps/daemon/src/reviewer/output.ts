/**
 * The Reviewer's structured output (ENG-222): one JSON document, decoded with
 * Effect Schema and never read as prose. Each Finding is validated, and one
 * whose lines aren't in the diff is dropped.
 */
import { createHash } from "node:crypto";
import { LineRange, RiskFinding, RiskFindingId, Severity } from "@polaris/protocol";
import { Effect, Result, Schema } from "effect";
import { type ChangeDiff, inDiff } from "./diff.ts";

const Line = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const ReviewerFindingOutput = Schema.Struct({
  path: Schema.String.annotate({ description: "The file's path at head, as the diff names it." }),
  startLine: Line,
  endLine: Line,
  side: Schema.Literals(["new", "old"]).annotate({
    description: '"new" for lines at head, "old" for removed lines.',
  }),
  severity: Severity.annotate({
    description:
      "critical: secrets, security, data loss. high: likely bug or breaking change. medium: worth a look. low: nits.",
  }),
  confidence: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  title: Schema.String.annotate({ description: "One line, under 80 characters." }),
  reason: Schema.String.annotate({ description: "Why it is a risk, in a few sentences." }),
  suggestion: Schema.NullOr(Schema.String).annotate({
    description: "Replacement text for the lines, or null.",
  }),
});

export type ReviewerFindingOutput = typeof ReviewerFindingOutput.Type;

export const ReviewerOutput = Schema.Struct({
  findings: Schema.Array(ReviewerFindingOutput).annotate({
    description: "New Findings. Leave out anything the rules already reported.",
  }),
  revised: Schema.Array(
    Schema.Struct({ findingId: Schema.String, finding: ReviewerFindingOutput })
  ).annotate({ description: "Earlier Findings of yours, corrected (follow-ups only)." }),
  withdrawn: Schema.Array(
    Schema.Struct({ findingId: Schema.String, note: Schema.String })
  ).annotate({ description: "Earlier Findings of yours that were wrong (follow-ups only)." }),
  answer: Schema.NullOr(Schema.String).annotate({
    description: "For a follow-up question: the answer, in Markdown. Null for a review.",
  }),
});

export type ReviewerOutput = typeof ReviewerOutput.Type;

/** The JSON Schema the prompt gives the Reviewer. */
export const reviewerOutputJsonSchema = (): string =>
  JSON.stringify(Schema.toJsonSchemaDocument(ReviewerOutput).schema);

const decodeOutput = Schema.decodeUnknownResult(ReviewerOutput);

const FENCED = /```(?:json)?\s*\n([\s\S]*?)\n```/g;

/** The JSON document in a reply: its last fenced block, else the whole reply. */
const documentOf = (reply: string): string => {
  const blocks = [...reply.matchAll(FENCED)].map((match) => match[1] ?? "");

  return (blocks.at(-1) ?? reply).trim();
};

/** The reply decoded, or what was wrong with it (sent back to the Reviewer once). */
export const parseReviewerReply = (reply: string): Result.Result<ReviewerOutput, string> => {
  let json: unknown;

  try {
    json = JSON.parse(documentOf(reply));
  } catch (error) {
    return Result.fail(`The reply was not one JSON document: ${String(error)}`);
  }

  return Result.mapError(decodeOutput(json), (error) => error.message);
};

const normalise = (code: string) => code.replaceAll(/\s+/g, " ").trim();

const hash = (parts: ReadonlyArray<string>) =>
  createHash("sha256").update(parts.join("\u0000")).digest("hex");

/**
 * A Reviewer Finding's identity (ENG-225): the source, the file, the flagged
 * code and two lines either side, whitespace-normalised. Never line numbers.
 */
export const agentIdentity = (path: string, code: string, context: string): string =>
  hash(["agent", path, normalise(code), normalise(context)]);

/** A file's lines at one side of the change; null when it doesn't exist there. */
export type ReadLines = (
  path: string,
  side: "new" | "old"
) => Effect.Effect<ReadonlyArray<string> | null>;

export interface Converted {
  readonly findings: ReadonlyArray<RiskFinding>;
  /** How many were dropped and why, for the layer's note. */
  readonly dropped: number;
}

const rangeOf = (finding: ReviewerFindingOutput) =>
  LineRange.make({
    start: Math.min(finding.startLine, finding.endLine),
    end: Math.max(finding.startLine, finding.endLine),
    side: finding.side,
  });

/** One output Finding as a `RiskFinding`, or null when its lines aren't in the diff. */
export const toRiskFinding = Effect.fn("toRiskFinding")(function* (
  finding: ReviewerFindingOutput,
  diff: ChangeDiff,
  readLines: ReadLines,
  id?: RiskFindingId
) {
  const lines = rangeOf(finding);

  if (!inDiff(diff, finding.path, lines)) return null;
  const file = (yield* readLines(finding.path, lines.side)) ?? [];
  const code = file.slice(lines.start - 1, lines.end).join("\n");

  const context = [
    ...file.slice(Math.max(0, lines.start - 3), lines.start - 1),
    ...file.slice(lines.end, lines.end + 2),
  ].join("\n");

  const identity = agentIdentity(finding.path, code, context);

  return RiskFinding.make({
    id: id ?? RiskFindingId.make(`agent-${hash([identity, finding.title]).slice(0, 24)}`),
    identity,
    source: "agent",
    ruleId: null,
    path: finding.path,
    lines,
    severity: finding.severity,
    confidence: finding.confidence,
    title: finding.title.trim(),
    reason: finding.reason.trim(),
    suggestion: finding.suggestion,
    status: "open",
    resolution: null,
  });
});

/** Every output Finding that validates against the diff, duplicates (by id) removed. */
export const toRiskFindings = Effect.fn("toRiskFindings")(function* (
  findings: ReadonlyArray<ReviewerFindingOutput>,
  diff: ChangeDiff,
  readLines: ReadLines
) {
  const kept = new Map<string, RiskFinding>();
  let dropped = 0;

  for (const finding of findings) {
    const converted = yield* toRiskFinding(finding, diff, readLines);

    if (converted === null) dropped += 1;
    else if (!kept.has(converted.id)) kept.set(converted.id, converted);
  }

  return { findings: [...kept.values()], dropped } satisfies Converted;
});
