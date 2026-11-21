/**
 * What an Inspector is given (ADR 0119): the Claim, the diff against base, the brief, the Area
 * and the Logbook. The worker's transcript is never part of it.
 */
import {
  type Attempt,
  CheckReceipt,
  type Claim,
  type Inspection,
  LogbookEntry,
  type Task,
} from "@polaris/protocol";
import { Predicate } from "effect";

export interface InspectorBrief {
  readonly task: Task;
  readonly attempt: Attempt;
  readonly claim: Claim;
  readonly inspection: Inspection;
  /** `git diff base...head`, already cut to size; null when this Host can't read it. */
  readonly diff: string | null;
  readonly logbook: ReadonlyArray<LogbookEntry>;
}

const list = (title: string, items: ReadonlyArray<string>) =>
  items.length === 0 ? [] : [`${title}:`, ...items.map((item) => `- ${item}`)];

const receipt = (r: CheckReceipt) =>
  CheckReceipt.match(r, {
    Verified: (v) => `${v.label} (verified: a command Polaris recorded)`,
    Reported: (v) =>
      `${v.label} (reported${v.exitCode == null ? "" : `, exit ${v.exitCode}`}): ${v.text}`,
  });

const claimLines = (claim: Claim) => [
  `Branch ${claim.branch} at ${claim.head}`,
  `Summary: ${claim.summary}`,
  ...list("Commits", claim.commits),
  ...list("Checks", claim.receipts.map(receipt)),
  ...list("Not done", claim.notDone),
  ...list("Follow-ups", claim.followups),
  ...list("Decisions", claim.decisions),
  ...list(
    "Outside its Area",
    claim.outsideArea.map((x) => `${x.path}: ${x.reason}`)
  ),
  ...list(
    "Questions",
    claim.questions.map((q) => `to ${q.to}: ${q.text}`)
  ),
];

const kind = (entry: LogbookEntry) =>
  LogbookEntry.match(entry, {
    Brief: () => "brief",
    Progress: () => "progress",
    Question: () => "question",
    Answer: () => "answer",
    Message: (e) => (e.channel === "peer" ? "peer message" : "message"),
    Claim: () => "claim",
    Review: (e) => `review ${e.outcome}`,
    Inspection: (e) => `inspection ${e.verdict}`,
    Lost: (e) => e.outcome,
    Note: () => "note",
  });

/** One line per entry: attempt, author, kind, text. The brief is given above, so it is left out. */
export const logbookLines = (entries: ReadonlyArray<LogbookEntry>) =>
  entries.flatMap((entry) =>
    Predicate.isTagged(entry, "Brief")
      ? []
      : [
          `- ${entry.attempt === null ? "" : `attempt ${entry.attempt} · `}${entry.author} · ${kind(entry)}${entry.text.trim() === "" ? "" : `: ${entry.text.replace(/\s+/g, " ").trim()}`}`,
        ]
  );

export const inspectorBrief = (input: InspectorBrief) => {
  const { task, attempt, claim, inspection } = input;
  const logbook = logbookLines(input.logbook);

  return [
    `Polaris inspection · ${task.id} · ${task.title}`,
    "You are the inspector of this claim: a second read before the lead hears of it. Read the claim against the brief, the criteria and the diff, then record one verdict with the verdict tool and end your turn. Change no files, make no commits and message no one.",
    inspection.accept
      ? "Verdicts: approve merges the claimed head and accepts the task, as the lead granted for it; send_back returns it to the worker with your reason as the next attempt's feedback."
      : "Verdicts: approve passes the claim to the lead with your reason, and the lead still accepts it; send_back returns it to the worker with your reason as the next attempt's feedback.",
    "Send back only for a concrete defect against the brief or criteria: name the file and what must change. Approve with what you checked and anything the lead should know.",
    ["Brief:", task.brief].join("\n"),
    list("Criteria", task.criteria).join("\n"),
    list("Area", task.area).join("\n"),
    ["Claim:", ...claimLines(claim)].join("\n"),
    `Base ${attempt.base} · worktree ${attempt.worktree}`,
    input.diff === null
      ? `The diff could not be read on this host. Read it with: git diff ${attempt.base}...${claim.head}`
      : [`Diff (git diff ${attempt.base}...${claim.head}):`, input.diff].join("\n"),
    logbook.length === 0 ? "" : ["Logbook, oldest first:", ...logbook].join("\n"),
  ]
    .filter((part) => part !== "")
    .join("\n\n");
};
