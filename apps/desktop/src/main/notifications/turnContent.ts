/**
 * What a Turn-ended notification says: the agent's reply under "{Harness} finished a turn"
 * (ENG-375), or "Review ready" / "Walkthrough ready" for a Reviewer's or walkthrough's own
 * session (ENG-378), over the change or session and its Host.
 */
import type { NeedsYouReview, NeedsYouTurn } from "../../shared/needsYou.ts";

export interface TurnContent {
  readonly title: string;
  readonly subtitle: string;
  readonly body: string;
}

/** The body when the turn ended without a reply, or its Daemon doesn't send one. */
export const NO_REPLY = "Ready for the next turn";

/** The walkthrough's first section, as its reply's plain text starts (`walkthroughPrompt.ts`). */
const WHY = "Why the change ";

const NEXT_SECTION = " Special things to note";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const findingsLine = (findings: NonNullable<NeedsYouReview["findings"]>) => {
  if (findings.open === 0) return "No open findings";
  const critical = findings.critical > 0 ? ` · ${findings.critical} critical` : "";

  return `${plural(findings.open, "finding")}${critical}`;
};

/** The walkthrough's one-sentence why, from its reply; null when the reply isn't one. */
const whyOf = (reply: string | null) => {
  if (reply === null || !reply.startsWith(WHY)) return null;
  const rest = reply.slice(WHY.length);
  const end = rest.indexOf(NEXT_SECTION);

  return end === -1 ? rest : rest.slice(0, end);
};

const reviewContent = (turn: NeedsYouTurn, review: NeedsYouReview): TurnContent => {
  const subtitle = `${review.change} · ${turn.hostLabel}`;

  if (review.kind === "walkthrough") {
    return {
      title: "Walkthrough ready",
      subtitle,
      body: whyOf(turn.reply) ?? `${turn.harness} walked through the change`,
    };
  }

  return {
    title: "Review ready",
    subtitle,
    body:
      review.findings === null
        ? `${turn.harness} reviewed the change`
        : findingsLine(review.findings),
  };
};

export const turnContent = (turn: NeedsYouTurn): TurnContent =>
  turn.review === undefined
    ? {
        title: `${turn.harness} finished a turn`,
        subtitle: `${turn.title} · ${turn.hostLabel}`,
        body: turn.reply ?? NO_REPLY,
      }
    : reviewContent(turn, turn.review);
