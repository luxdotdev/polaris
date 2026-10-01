/**
 * "Also reviewed by Suzuka · ● Caution · Open" under the risk column's tally (Paper R9):
 * a review bot's verdict beside Polaris's own, opening its summary on Overview.
 */
import { SeverityGlyph } from "@polaris/ui";
import type { ReviewSubject } from "../../../../routes/review.ts";
import { useLoadedPullDetail } from "../../data/pullDetail.ts";
import { subjectKey } from "../../surface.ts";
import { overviewOf } from "../data/overview.ts";
import { ALERT_SEVERITY, botName } from "../model/botSummary.ts";
import { setTab } from "../model/tabs.ts";
import { Mark } from "./parts.tsx";

const NO_PULL = { repo: { owner: "", name: "" }, number: 0 };

export const AlsoReviewed = ({ subject }: { readonly subject: ReviewSubject }) => {
  const detail = useLoadedPullDetail(subject.kind === "pull" ? subject.pull : NO_PULL);
  const summary = detail === null ? null : overviewOf(detail).botSummary;

  if (summary === null) return null;
  const name = botName(summary.bot);
  const severity = summary.verdict === null ? null : ALERT_SEVERITY[summary.verdict.alert];

  return (
    <button
      type="button"
      data-testid="also-reviewed"
      onClick={() => setTab(subjectKey(subject), "overview")}
      className="rounded-control bg-surface-sunken text-caption hover:bg-fill-hover mt-2 flex h-7 w-full cursor-default items-center gap-1.5 px-2 text-left"
    >
      <Mark person={{ login: name, bot: true }} />
      <span className="text-text-default">
        Also reviewed by {name.slice(0, 1).toUpperCase()}
        {name.slice(1)}
      </span>
      {summary.verdict !== null && severity !== null && (
        <span
          className="flex items-center gap-1 font-medium"
          style={{ color: `var(--color-severity-${severity}-text)` }}
        >
          <SeverityGlyph severity={severity} tone="text" />
          {summary.verdict.word}
        </span>
      )}
      <span className="text-text-subtle ml-auto">Open</span>
    </button>
  );
};
