/**
 * A review bot's pinned summary (Paper R9 AWJ-0, BPB-0): the bot mark, its verdict pill in
 * the Severity colour, the first paragraph and the checks line, then the full GFM summary
 * on demand. Stale when it reviewed an older head; its commands sit behind the menu.
 */
import { CheckIcon, CloseIcon, SeverityGlyph } from "@polaris/ui";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { OpenPull } from "../../../../../shared/api.ts";
import {
  ALERT_SEVERITY,
  botName,
  checksFailed,
  checksLine,
  firstParagraph,
  shortSha,
  type Staleness,
  summaryBody,
  summaryLinks,
} from "../model/botSummary.ts";
import { ago, count } from "../model/copy.ts";
import type { BotSummaryView } from "../model/types.ts";
import { BotMenu } from "./BotMenu.tsx";
import { ReviewMarkdown } from "./markdown/index.tsx";
import { reviewLinks } from "./links.tsx";
import { BotTag, Card, CardHead, ExternalLink, Mark, TextAction } from "./parts.tsx";

const TINT = {
  critical: "bg-[color-mix(in_oklab,var(--color-severity-critical)_14%,transparent)]",
  high: "bg-[color-mix(in_oklab,var(--color-severity-high)_14%,transparent)]",
  medium: "bg-[color-mix(in_oklab,var(--color-severity-medium)_14%,transparent)]",
  low: "bg-[color-mix(in_oklab,var(--color-severity-low)_14%,transparent)]",
} as const;

/** "● Caution" in the alert's Severity colour (OVERVIEW.md: Caution is medium). */
const Verdict = ({ verdict }: { readonly verdict: NonNullable<BotSummaryView["verdict"]> }) => {
  const severity = ALERT_SEVERITY[verdict.alert];

  return (
    <span
      data-testid="bot-verdict"
      data-severity={severity}
      className={`rounded-control text-caption flex h-5 shrink-0 items-center gap-[5px] px-[7px] font-medium ${TINT[severity]}`}
      style={{ color: `var(--color-severity-${severity}-text)` }}
    >
      <SeverityGlyph severity={severity} tone="text" />
      {verdict.word}
    </span>
  );
};

const caption = (summary: BotSummaryView, staleness: Staleness, now: number) => {
  const reviewed = summary.reviewedHead === null ? null : shortSha(summary.reviewedHead);

  if (staleness.kind === "behind" && reviewed !== null) {
    const behind =
      staleness.commits === null ? "older head" : `${count(staleness.commits, "commit")} behind`;

    return `Summary of ${reviewed} · ${behind}`;
  }

  return ["Summary", reviewed === null ? null : `reviewed ${reviewed}`, ago(summary.updatedAt, now)]
    .filter((p) => p !== null)
    .join(" · ");
};

/** Which Reviews have their bot summary open; kept apart from the card, which moves on re-review. */
const openStore = createStore<Readonly<Record<string, boolean>>>(() => ({}));

export interface BotSummaryCardProps {
  readonly subjectKey: string;
  readonly pull: Pick<OpenPull, "repo" | "number">;
  readonly summary: BotSummaryView;
  readonly staleness: Staleness;
  readonly head: string;
  readonly viewer: string;
  readonly paths: ReadonlyArray<string>;
  readonly now: number;
}

export const BotSummaryCard = (props: BotSummaryCardProps) => {
  const { subjectKey, summary, staleness, paths, now } = props;
  const open = useStore(openStore, (s) => s[subjectKey] ?? false);
  const setOpen = (next: boolean) => openStore.setState({ [subjectKey]: next });
  const name = botName(summary.bot);
  const line = checksLine(summary.body);
  const links = summaryLinks(summary.body);

  return (
    <Card
      data-testid="bot-summary"
      data-bot={name}
      data-stale={staleness.kind === "behind" ? "" : undefined}
      data-open={open ? "" : undefined}
    >
      <CardHead>
        <Mark person={{ login: name, bot: true }} />
        <span className="text-body text-text-strong font-medium">{name}</span>
        <BotTag />
        {summary.verdict !== null && <Verdict verdict={summary.verdict} />}
        <span
          className="text-caption text-text-subtle min-w-0 flex-1 truncate"
          data-testid="bot-summary-caption"
        >
          {caption(summary, staleness, now)}
        </span>
        <span className="text-caption text-text-subtle">Pinned</span>
        <BotMenu
          bot={name}
          pull={props.pull}
          head={props.head}
          viewer={props.viewer}
          stale={staleness.kind === "behind"}
        />
      </CardHead>
      {open ? (
        <div className="pr-3.5 pb-1 pl-[42px]" data-testid="bot-summary-full">
          <ReviewMarkdown
            markdown={summaryBody(summary.body)}
            paths={paths}
            renderLink={reviewLinks(subjectKey)}
          />
        </div>
      ) : (
        <>
          <p className="text-body text-text-default pr-3.5 pl-[42px] leading-5">
            {firstParagraph(summary.body).replace(/[`*_]/g, "")}
          </p>
          {line !== null && (
            <p className="text-caption text-text-subtle pt-gap flex items-center gap-1.5 pr-3.5 pl-[42px]">
              {checksFailed(line) ? <CloseIcon size={12} /> : <CheckIcon size={12} />}
              <span className="truncate">{line}</span>
            </p>
          )}
        </>
      )}
      <div className="pt-row-x flex items-center gap-3.5 pr-3.5 pb-3 pl-[42px]">
        {open && summary.reviewedHead !== null && (
          <span className="text-caption text-text-subtle flex-1">
            Reviewed {shortSha(summary.reviewedHead)}
            {summary.reviewedBase === null ? "" : ` against ${shortSha(summary.reviewedBase)}`}
          </span>
        )}
        <TextAction strong onClick={() => setOpen(!open)} data-testid="bot-summary-toggle">
          {open ? "Show less" : "Show full summary"}
        </TextAction>
        {links.fullReview !== null && (
          <ExternalLink href={links.fullReview}>Full review</ExternalLink>
        )}
        <ExternalLink href={links.reviewPage ?? summary.url}>Review page</ExternalLink>
      </div>
    </Card>
  );
};
