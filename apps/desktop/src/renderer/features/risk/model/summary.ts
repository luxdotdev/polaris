/**
 * What the risk column shows for a Risk Summary (DESIGN.md, Review; ENG-185, ENG-225): the
 * Severity tally, the findings ranked by Severity then confidence with Critical always on
 * top, the collapsed Dismissed and Resolved groups, the header caption and the cost line.
 */
import type { RiskFinding, RiskSummary, Severity } from "@polaris/protocol";
import type { Plain } from "../../../store/plain.ts";

export type Summary = Plain<RiskSummary>;

export type Finding = Plain<RiskFinding>;

const RANK: Readonly<Record<Severity, number>> = { critical: 0, high: 1, medium: 2, low: 3 };

const SOURCE_RANK: Readonly<Record<Finding["source"], number>> = {
  rule: 0,
  classifier: 1,
  agent: 2,
};

/** Severity, then confidence (highest first), then rules before the Reviewer (as `rankFindings`). */
export const rank = (findings: ReadonlyArray<Finding>): ReadonlyArray<Finding> =>
  findings.toSorted(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      b.confidence - a.confidence ||
      SOURCE_RANK[a.source] - SOURCE_RANK[b.source]
  );

/** Non-Critical findings under 50% confidence are dimmed; a Critical one never is (ENG-185). */
export const isDimmed = (finding: Finding) =>
  finding.severity !== "critical" && finding.confidence < 0.5;

/** Nothing hides a Critical finding: it stays in the ranked list whatever its status. */
const isListed = (finding: Finding) => finding.status === "open" || finding.severity === "critical";

export interface FindingGroups {
  /** Open findings, plus every Critical one. */
  readonly listed: ReadonlyArray<Finding>;
  /** Thumbs-down (ENG-225): collapsed under "Dismissed". */
  readonly dismissed: ReadonlyArray<Finding>;
  /** Withdrawn by the Reviewer, or fixed by a later commit. */
  readonly resolved: ReadonlyArray<Finding>;
  /** Listed findings per Severity. */
  readonly tally: Readonly<Record<Severity, number>>;
}

export const groupFindings = (findings: ReadonlyArray<Finding>): FindingGroups => {
  const ranked = rank(findings);
  const listed = ranked.filter(isListed);
  const tally = { critical: 0, high: 0, medium: 0, low: 0 };

  for (const finding of listed) tally[finding.severity] += 1;

  return {
    listed,
    dismissed: ranked.filter((f) => !isListed(f) && f.status === "dismissed"),
    resolved: ranked.filter((f) => !isListed(f) && f.status === "resolved"),
    tally,
  };
};

const SOURCE_LABEL: Readonly<Record<Finding["source"], string>> = {
  rule: "rule",
  classifier: "classifier",
  agent: "reviewer",
};

const lineLabel = (finding: Finding) =>
  finding.lines.start === finding.lines.end
    ? `${finding.lines.start}`
    : `${finding.lines.start}–${finding.lines.end}`;

/** "api/eligibility.ts:41". */
export const placeOf = (finding: Finding) => `${finding.path}:${lineLabel(finding)}`;

/** "reviewer · 86%". */
export const provenanceOf = (finding: Finding) =>
  `${SOURCE_LABEL[finding.source]} · ${Math.round(finding.confidence * 100)}%`;

/** The file's name alone, for a collapsed row ("limits.test.ts · reviewer · 71%"). */
export const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const short = (sha: string) => sha.slice(0, 7);

/** "1m ago": shared with the cost line's age. */
const age = (ms: number) => {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);

  if (minutes < 1) return "just now";

  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);

  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
};

const runningCaption = (summary: Summary) => {
  if (summary.layers.rules.status === "running" || summary.layers.rules.status === "pending") {
    return "Running rules…";
  }

  return summary.layers.agent.status === "running"
    ? `The reviewer is reading the change at ${short(summary.key.head)}…`
    : `Reviewing ${short(summary.key.head)}…`;
};

/** The header's one line: what ran, at which commit, and when. */
export const captionOf = (summary: Summary, now: number): string => {
  if (summary.status === "running") return runningCaption(summary);

  if (summary.status === "failed") return `Couldn’t finish at ${short(summary.key.head)}`;

  const scope =
    summary.key.since === null
      ? `at ${short(summary.key.head)}`
      : `at ${short(summary.key.head)}, new commits since ${short(summary.key.since)}`;

  const when = summary.endedAt === null ? "" : ` · ${age(now - Date.parse(summary.endedAt))}`;
  const verb = summary.layers.agent.status === "completed" ? "Reviewed" : "Rules ran";

  return `${verb} ${scope}${when}`;
};

/**
 * Where the Reviewer is on a summary, from its agent layer: the one fact the header's action,
 * the cost line and the Ask box all read, so they never disagree.
 * - `none`: no Reviewer is available on the Host (the Daemon's "Rules only…" note).
 * - `off`: switched off for this kind of change, or the Rules after a single Turn.
 * - `waiting`: over the Ask-first threshold, waiting for "Run reviewer".
 * - `running`, `failed` (the agent layer's note says why), `ran`.
 */
export type ReviewerState = "none" | "off" | "waiting" | "running" | "failed" | "ran";

export const reviewerState = (summary: Summary): ReviewerState => {
  const { status, note } = summary.layers.agent;

  switch (status) {
    case "completed":
      return "ran";
    case "failed":
      return "failed";
    case "running":
      return "running";
    case "pending":
      return summary.status === "running" ? "running" : "waiting";
    case "skipped":
      return note?.startsWith("Rules only") === true ? "none" : "off";
  }
};

/**
 * The header's action: "Run reviewer" when the Reviewer waits or was switched off,
 * else "Review again". Both run with `refresh`.
 */
export const rerunLabel = (summary: Summary | null) => {
  if (summary === null || summary.status === "running") return "Review again";
  const state = reviewerState(summary);

  return state === "waiting" || state === "off" ? "Run reviewer" : "Review again";
};

/** Why a layer didn't finish, and the summary's note (a Plan Limit, "Rules only…"), deduplicated. */
export const notesOf = (summary: Summary): ReadonlyArray<string> => {
  const notes = [summary.note, summary.layers.rules.note, summary.layers.agent.note].filter(
    (note): note is string => note !== null && note.trim() !== ""
  );

  return [...new Set(notes)];
};

/** "182k tokens", "1.2M tokens". */
const tokens = (n: number) => {
  if (n < 1000) return `${n} tokens`;

  if (n < 1_000_000) return `${Math.round(n / 1000)}k tokens`;

  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M tokens`;
};

const usd = (n: number) => (n < 0.01 ? "<$0.01" : `~$${n.toFixed(2)}`);

export interface CostNames {
  /** "Codex", "Claude Code". */
  readonly harness: string;
  /** "GPT-6.1-Sol · high", or null for the Harness's default. */
  readonly model: string | null;
}

/**
 * ENG-229's quiet line: "Reviewed by Codex · GPT-6.1-Sol · 182k tokens · ~$0.40". Only
 * for a Reviewer that ran: one named on a waiting or failed summary didn't review it.
 */
export const costLine = (summary: Summary, names: CostNames | null): string | null => {
  if (reviewerState(summary) !== "ran" || summary.reviewer?.sessionId == null || names === null) {
    return null;
  }

  const parts = [`Reviewed by ${names.harness}`];

  if (names.model !== null) parts.push(names.model);

  if (summary.cost !== null) {
    parts.push(tokens(summary.cost.tokens));

    if (summary.cost.costUsd !== null) parts.push(usd(summary.cost.costUsd));
  }

  return parts.join(" · ");
};

/** The line under the findings: the cost line once the Reviewer ran, else where it is. */
export const reviewerLine = (summary: Summary, names: CostNames | null): string => {
  const cost = costLine(summary, names);

  if (cost !== null) return cost;

  switch (reviewerState(summary)) {
    case "none":
      return "Rules only: no reviewer on this host";
    case "off":
      return "Rules only: the reviewer didn’t run on this change";
    case "waiting":
      return "The reviewer is waiting: Run reviewer to review this change";
    case "running":
      return "The reviewer is reading the change…";
    case "failed":
      return summary.layers.agent.note ?? "The reviewer couldn’t finish";
    case "ran":
      return "Reviewed";
  }
};

/** The Ask box's placeholder: you can ask only a Reviewer that ran. */
export const askPlaceholder = (summary: Summary, aboutFinding: boolean): string => {
  switch (reviewerState(summary)) {
    case "ran":
      return aboutFinding ? "Ask about this finding" : "Ask the reviewer about this change";
    case "none":
      return "Rules only: there’s no reviewer to ask";
    case "running":
      return "The reviewer is still reading the change";
    case "failed":
      return "The reviewer couldn’t finish: review again to ask";
    case "off":
    case "waiting":
      return "Run reviewer first to ask about this change";
  }
};

/** True when a follow-up can go to the Reviewer's own session. */
export const canAskReviewer = (summary: Summary): boolean =>
  reviewerState(summary) === "ran" && summary.reviewer?.sessionId != null;

/** The finding a stale selection pointed at, else null (a refreshed summary may drop it). */
export const findingById = (summary: Summary | null, id: string | null): Finding | null =>
  id === null ? null : (summary?.findings.find((f) => f.id === id) ?? null);
