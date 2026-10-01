/**
 * Rule Findings as Risk Findings (CONTEXT.md: Risk Finding, Severity). The
 * identity is stable across commits and never uses line numbers: source,
 * rule, file and the flagged code, whitespace-normalised, with two lines of
 * context. For a secret the flagged code is its fingerprint, never its value.
 */
import { createHash } from "node:crypto";
import { LineRange, RiskFinding, RiskFindingId, type Severity } from "@polaris/protocol";
import type { PackRule } from "./patterns/pack.ts";
import type { PatternMatch } from "./patterns/scan.ts";
import type { Confidence, SecretHit } from "./secrets/betterleaks.ts";

const normalise = (code: string) => code.replaceAll(/\s+/g, " ").trim();

const hash = (parts: ReadonlyArray<string>) =>
  createHash("sha256").update(parts.join("\u0000")).digest("hex");

/** The identity of a Finding (RiskFinding.identity). */
export const findingIdentity = (
  ruleId: string,
  path: string,
  code: string,
  context: string
): string => hash(["rule", ruleId, path, normalise(code), normalise(context)]);

const build = (fields: {
  readonly identity: string;
  readonly ruleId: string;
  readonly path: string;
  readonly start: number;
  readonly end: number;
  readonly severity: Severity;
  readonly confidence: number;
  readonly title: string;
  readonly reason: string;
}) =>
  RiskFinding.make({
    id: RiskFindingId.make(`rule-${fields.identity.slice(0, 24)}`),
    identity: fields.identity,
    source: "rule",
    ruleId: fields.ruleId,
    path: fields.path,
    lines: LineRange.make({
      start: fields.start,
      end: Math.max(fields.start, fields.end),
      side: "new",
    }),
    severity: fields.severity,
    confidence: fields.confidence,
    title: fields.title,
    reason: fields.reason,
    suggestion: null,
    status: "open",
    resolution: null,
  });

// ── Secrets ─────────────────────────────────────────────────────────────────

/**
 * ENG-230: a likely credential is Critical, which nothing hides; Betterleaks'
 * low-confidence generic matches are Medium, so they can be dismissed.
 */
export const secretSeverity = (confidence: Confidence): Severity =>
  confidence === "high" || confidence === "medium" ? "critical" : "medium";

const SECRET_CONFIDENCE: Readonly<Record<Confidence, number>> = {
  high: 0.9,
  medium: 0.6,
  low: 0.3,
  "": 0.3,
};

const ACRONYMS = new Map([
  ["api", "API"],
  ["aws", "AWS"],
  ["gcp", "GCP"],
  ["github", "GitHub"],
  ["gitlab", "GitLab"],
  ["jwt", "JWT"],
  ["pat", "PAT"],
  ["ssh", "SSH"],
  ["uri", "URI"],
  ["url", "URL"],
]);

/** `aws-access-token` → `AWS access token`: Betterleaks' rule ids, readable. */
export const humanise = (ruleId: string): string => {
  const words = ruleId.split("-").map((word) => ACRONYMS.get(word) ?? word);
  const first = words[0] ?? "";

  return [first.charAt(0).toUpperCase() + first.slice(1), ...words.slice(1)].join(" ");
};

export const secretFinding = (hit: SecretHit, history: boolean): RiskFinding =>
  build({
    identity: hash(["rule", hit.ruleId, hit.path, hit.fingerprint]),
    ruleId: hit.ruleId,
    path: hit.path,
    start: hit.start,
    end: hit.end,
    severity: secretSeverity(hit.confidence),
    confidence: SECRET_CONFIDENCE[hit.confidence],
    title: `Possible secret: ${humanise(hit.ruleId)}`,
    reason: [
      hit.description,
      `Matched ${hit.masked}.`,
      history ? "Once merged it stays in the history, even if a later commit removes it." : "",
    ]
      .filter((part) => part !== "")
      .join(" "),
  });

// ── Patterns ────────────────────────────────────────────────────────────────

/** Two lines either side of a match, from the scanned file's lines. */
export const contextOf = (lines: ReadonlyArray<string>, start: number, end: number): string =>
  [...lines.slice(Math.max(0, start - 3), start - 1), ...lines.slice(end, end + 2)].join("\n");

export const patternFinding = (
  rule: PackRule,
  match: PatternMatch,
  lines: ReadonlyArray<string>
): RiskFinding =>
  build({
    identity: findingIdentity(
      rule.id,
      match.path,
      match.text,
      contextOf(lines, match.start, match.end)
    ),
    ruleId: rule.id,
    path: match.path,
    start: match.start,
    end: match.end,
    severity: rule.severity,
    confidence: rule.confidence,
    title: rule.message,
    reason: rule.note ?? `${rule.message} (${rule.category} rule ${rule.id}).`,
  });
