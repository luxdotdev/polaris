/**
 * A review bot's pinned summary (Suzuka's `<!-- suzuka:summary -->` comment): the verdict
 * pill in its Severity colour, the first paragraph and the checks line for the folded card,
 * and whether it reviewed an older head.
 */
import type { Severity } from "@polaris/protocol";
import type { AlertKind, BotSummaryView, CommitView } from "./types.ts";

/** Caution sits in a `[!WARNING]` alert: medium. Notes are low, `[!CAUTION]` is danger. */
export const ALERT_SEVERITY: Readonly<Record<AlertKind, Severity>> = {
  note: "low",
  tip: "low",
  important: "high",
  warning: "medium",
  caution: "critical",
};

const MARKER = /^\s*<!--[\s\S]*?-->\s*/;

const isProse = (block: string) => {
  const first = block.trimStart();

  return !/^(>|#|<|\||[-*+] |\d+\. |```|~~~|---)/.test(first);
};

/** The summary's first paragraph of prose: past the marker, the alert and any heading. */
export const firstParagraph = (body: string): string => {
  const blocks = body.replace(MARKER, "").split(/\n\s*\n/);

  return (blocks.find((b) => b.trim() !== "" && isProse(b)) ?? "").trim().replace(/\s*\n\s*/g, " ");
};

const CHECK_WORDS = /\b(passed|failed|failing|skipped)\b/;

/** "typecheck passed · lint passed · …": the first line that lists check results. */
export const checksLine = (body: string): string | null => {
  const line = body
    .split("\n")
    .map((l) => l.trim().replace(/^[-*>]\s*/, ""))
    .find((l) => l.includes("·") && CHECK_WORDS.test(l) && !l.startsWith("|"));

  return line === undefined ? null : line.replace(/[*_`]/g, "");
};

/** Whether the checks line reports a failure (its tick turns into a cross). */
export const checksFailed = (line: string) => /\b(failed|failing)\b/.test(line);

export type Staleness =
  | { readonly kind: "current" }
  | { readonly kind: "behind"; readonly commits: number | null };

/** How far the summary's reviewed head is behind `head`; unknown counts as current. */
export const stalenessOf = (
  summary: BotSummaryView,
  head: string,
  commits: ReadonlyArray<CommitView>
): Staleness => {
  const reviewed = summary.reviewedHead;

  if (reviewed === null || head === "" || head.startsWith(reviewed) || reviewed.startsWith(head)) {
    return { kind: "current" };
  }

  const at = commits.findIndex((c) => c.oid.startsWith(reviewed));

  return { kind: "behind", commits: at === -1 ? null : commits.length - 1 - at };
};

/** The bot's display name: "suzuka". */
export const botName = (bot: string) => bot.replace(/\[bot\]$/, "");

/** The short sha GitHub shows. */
export const shortSha = (oid: string) => oid.slice(0, 7);

export interface BotCommand {
  readonly command: "review" | "retry" | "memory";
  readonly label: string;
  readonly slash: string;
}

export const BOT_COMMANDS: ReadonlyArray<BotCommand> = [
  { command: "review", label: "Re-run", slash: "/review" },
  { command: "retry", label: "Retry the last run", slash: "/retry" },
  { command: "memory", label: "Teach", slash: "/memory" },
];
