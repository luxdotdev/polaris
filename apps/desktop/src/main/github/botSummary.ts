/** Summary comments stay pinned above the timeline, regardless of which bot wrote them. */
import type { BotSummaryView } from "../../shared/github.ts";

export interface SummaryComment {
  readonly id: string;
  readonly body: string;
  readonly url: string;
  readonly updatedAt: string;
}

const MARKER = /^<!--\s*([a-z0-9_-]+):summary\s*-->/i;

const ALERT = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]([^\n]*(?:\n>[^\n]*)*)/im;

const VERDICT = /\*\*([^*\n]+)\*\*/;

const REVIEWED = /Reviewed\s+`?([0-9a-f]{7,64})`?\s+against\s+`?([0-9a-f]{7,64})`?/i;

const ALERTS = new Map<string, NonNullable<BotSummaryView["verdict"]>["alert"]>([
  ["NOTE", "note"],
  ["TIP", "tip"],
  ["IMPORTANT", "important"],
  ["WARNING", "warning"],
  ["CAUTION", "caution"],
]);

export const summaryBot = (body: string): string | null =>
  MARKER.exec(body)?.[1]?.toLowerCase() ?? null;

export const latestBotSummary = (
  comments: ReadonlyArray<SummaryComment>
): BotSummaryView | null => {
  const latest = comments
    .filter((c) => summaryBot(c.body) !== null)
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  if (latest === undefined) return null;

  const bot = summaryBot(latest.body);

  if (bot === null) return null;

  const alert = ALERT.exec(latest.body);
  const kind = ALERTS.get(alert?.[1]?.toUpperCase() ?? "");
  const word = VERDICT.exec(alert?.[2] ?? "")?.[1];
  const reviewed = REVIEWED.exec(latest.body);

  return {
    bot,
    commentId: latest.id,
    url: latest.url,
    body: latest.body,
    verdict: kind === undefined || word === undefined ? null : { alert: kind, word },
    reviewedHead: reviewed?.[1] ?? null,
    reviewedBase: reviewed?.[2] ?? null,
    updatedAt: latest.updatedAt,
  };
};
