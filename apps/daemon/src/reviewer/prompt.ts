/**
 * The Reviewer's prompts (ENG-222): what it may do, the change and why it was
 * made, the repo's instructions, the Rules' Findings (so it neither repeats
 * them nor misses them), the diff, and the output contract.
 */
import type { RiskFinding } from "@polaris/protocol";
import type { ChangeDiff } from "./diff.ts";
import { reviewerOutputJsonSchema } from "./output.ts";

/** Marks a Reviewer prompt; the bench Harness answers it with schema output. */
export const REVIEWER_MARKER = "<!-- polaris:reviewer -->";

/** The diff text the prompt carries at most; past it, files are listed to read with git. */
export const DIFF_BUDGET_CHARS = 240_000;

export interface ReviewPromptInput {
  /** "Pull request #12: Title", or the Agent Session's title. */
  readonly subject: string;
  /** The PR description, or the session's prompts in order. */
  readonly why: string | null;
  readonly instructions: string | null;
  readonly ruleFindings: ReadonlyArray<RiskFinding>;
  readonly diff: ChangeDiff;
  readonly base: string;
  readonly head: string;
  /** Set for "only the new changes": the head the previous Risk Summary covered. */
  readonly since: string | null;
  /** Findings already open on this Review (an incremental run), so they aren't repeated. */
  readonly earlierFindings: ReadonlyArray<RiskFinding>;
  /** False where tests can't be kept off the network: the Reviewer only reads. */
  readonly runChecks: boolean;
}

const lines = (finding: RiskFinding) =>
  finding.lines.start === finding.lines.end
    ? `${finding.lines.start}`
    : `${finding.lines.start}-${finding.lines.end}`;

const findingLine = (finding: RiskFinding) =>
  `- [${finding.id}] ${finding.severity} · ${finding.path}:${lines(finding)}${
    finding.lines.side === "old" ? " (removed)" : ""
  } · ${finding.title}`;

const CONTRACT = (schema: string) =>
  [
    "## Your reply",
    "End your final message with exactly one fenced ```json block holding a document that matches this JSON Schema; nothing after it. Polaris reads only that block.",
    "",
    "```json",
    schema,
    "```",
    "",
    '- `startLine`/`endLine` are 1-based line numbers in the file at head (`side: "new"`), or at base for removed lines (`side: "old"`), and must fall inside a hunk of the diff. Findings elsewhere are dropped.',
    "- Severity: critical = secrets, security, data loss; high = likely bug or breaking change; medium = worth a look; low = nits.",
    "- `confidence` is 0 to 1: how sure you are this is a real problem.",
    "- Report risks, not praise or summaries. An empty `findings` array is a fine answer.",
  ].join("\n");

const NO_CHECKS =
  "On this Host the repo's tests, lint and typecheck can't be kept off the network, so they are refused too: judge from reading the code.";

const RULES = [
  "You are Polaris's Reviewer: a careful senior engineer reviewing a change for risks.",
  "You are read-only. You may read and search files, run `git diff`, `git log`, `git show` and similar read-only git commands, and run the repo's tests, lint and typecheck. You can't edit files, and you have no network. Anything else is refused.",
  "Work in this checkout; read whole files where the diff alone doesn't show enough.",
].join("\n");

/** Whole files' patches up to the budget, then the rest by name. */
const diffSection = (diff: ChangeDiff, base: string, head: string): string => {
  const shown: Array<string> = [];
  const listed: Array<string> = [];
  let used = 0;

  for (const file of diff.files) {
    if (used + file.patch.length <= DIFF_BUDGET_CHARS) {
      shown.push(file.patch);
      used += file.patch.length;
    } else listed.push(`- ${file.path}`);
  }

  const parts = [`## The diff (\`git diff ${base} ${head}\`)`, "", "```diff", ...shown, "```"];

  if (listed.length > 0) {
    parts.push(
      "",
      `These files changed too but didn't fit; read them with \`git diff ${base} ${head} -- <path>\`:`,
      ...listed
    );
  }

  return parts.join("\n");
};

export const reviewPrompt = (input: ReviewPromptInput): string => {
  const sections = [
    REVIEWER_MARKER,
    input.runChecks ? RULES : `${RULES}\n${NO_CHECKS}`,
    `## The change\n\n${input.subject}`,
  ];

  if (input.why !== null && input.why.trim() !== "") {
    sections.push(`## Why it was made\n\n${input.why.trim()}`);
  }

  if (input.instructions !== null) {
    sections.push(`## The repo's review instructions\n\n${input.instructions}`);
  }

  if (input.since !== null) {
    sections.push(
      `## Only the new changes\n\nYou reviewed this change before, at ${input.since}. The diff below holds only what changed since then.` +
        (input.earlierFindings.length > 0
          ? ` Your earlier Findings, still open (don't report them again):\n\n${input.earlierFindings.map(findingLine).join("\n")}`
          : "")
    );
  }

  if (input.ruleFindings.length > 0) {
    sections.push(
      `## Already reported by the rules (don't repeat these)\n\n${input.ruleFindings.map(findingLine).join("\n")}`
    );
  }

  sections.push(
    input.diff.files.length > 0
      ? diffSection(input.diff, input.base, input.head)
      : "## The diff\n\nNo file changed.",
    CONTRACT(reviewerOutputJsonSchema())
  );

  return sections.join("\n\n");
};

export interface FollowUpInput {
  readonly question: string;
  /** The Finding asked about; null for a question about the whole change. */
  readonly finding: RiskFinding | null;
}

/** A follow-up in the Reviewer's own session, which already holds the review. */
export const followUpPrompt = (input: FollowUpInput): string =>
  [
    REVIEWER_MARKER,
    input.finding === null
      ? "A question about this change:"
      : `A question about your Finding:\n\n${findingLine(input.finding)}\n\n${input.finding.reason}`,
    "",
    input.question.trim(),
    "",
    "Answer in `answer`. If the answer changes your review, add Findings in `findings`, correct earlier ones in `revised` (by `findingId`), or withdraw wrong ones in `withdrawn`; otherwise leave those empty.",
    "",
    CONTRACT(reviewerOutputJsonSchema()),
  ].join("\n");

/** Sent once when a reply doesn't decode. */
export const repairPrompt = (problem: string): string =>
  [
    REVIEWER_MARKER,
    "Your last reply couldn't be read:",
    "",
    problem,
    "",
    "Send the same review again as exactly one fenced ```json block matching the schema, and nothing else.",
  ].join("\n");
