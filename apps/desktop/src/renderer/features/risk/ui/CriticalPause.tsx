/**
 * The pause inside Submit review's popover while a Critical finding is open (Paper X-G):
 * it names the finding, then Submit review goes on to the review; asking the Reviewer about
 * it (or showing it) closes the popover. It asks once per set of open criticals.
 */
import { Button, Kicker, SEVERITY_LABELS, SeverityGlyph } from "@polaris/ui";
import type { ReactNode } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { emptySurface, revealInDiff, surfaceStore, updateSurface } from "../../review/index.ts";
import { useRisk } from "../data/riskStore.ts";
import { setAskAbout } from "../data/ui.ts";
import { canAskReviewer } from "../model/summary.ts";
import { openCriticals, pauseKey, pauseTitle, shouldPause } from "../model/pause.ts";
import { reviewerName } from "./AskReviewer.tsx";

/** Per Review, the set of open criticals the user chose to submit past. */
const settledStore = createStore<Readonly<Record<string, string>>>(() => ({}));

export interface SubmitPauseProps {
  readonly subjectKey: string;
  /** Closes the Submit review popover. */
  readonly onClose: () => void;
  /** The review form, once nothing pauses it. */
  readonly children: ReactNode;
}

const placeOf = (finding: { readonly path: string; readonly lines: { readonly start: number } }) =>
  `${finding.path.slice(finding.path.lastIndexOf("/") + 1)}:${finding.lines.start}`;

export const CriticalPause = ({ subjectKey, onClose, children }: SubmitPauseProps) => {
  const findings = useStore(surfaceStore, (s) => (s[subjectKey] ?? emptySurface).findings);
  const settled = useStore(settledStore, (s) => s[subjectKey] ?? null);
  const risk = useRisk(subjectKey);
  const criticals = openCriticals(findings);
  const [first] = criticals;

  if (!shouldPause(criticals, settled) || first === undefined) return children;

  // Who "Ask … about it" goes to; null when the Reviewer can't be asked.
  const asked =
    risk.kind === "ready" && canAskReviewer(risk.summary) ? reviewerName(risk.summary) : null;

  const followUp = () => {
    if (asked !== null) setAskAbout(subjectKey, first.id);
    updateSurface(subjectKey, { selectedFinding: first.id });
    revealInDiff(first.path, first.lines.end, first.lines.side);
    onClose();
  };

  return (
    <div className="flex flex-col gap-3 p-3.5" data-testid="critical-pause">
      <span className="text-heading-sm text-text-strong font-medium">
        {pauseTitle(criticals.length)}
      </span>
      <div className="bg-well border-hairline flex flex-col gap-2 rounded-[12px] border px-3 py-2.5">
        {criticals.slice(0, 3).map((finding) => (
          <div
            key={finding.id}
            className="flex flex-col gap-1"
            data-testid="critical-pause-finding"
          >
            <span className="text-body gap-gap flex min-w-0 items-baseline">
              <span
                className="text-caption flex shrink-0 items-center gap-1.5"
                style={{ color: "var(--color-severity-critical-text)" }}
              >
                <SeverityGlyph severity="critical" tone="text" />
                {SEVERITY_LABELS.critical}
              </span>
              <span className="text-text-strong min-w-0 truncate">{finding.title}</span>
            </span>
            <Kicker className="normal-case">{placeOf(finding)}</Kicker>
          </div>
        ))}
      </div>
      <p className="text-caption text-text-subtle">
        {asked !== null
          ? `Submit anyway, or ask ${asked} about it first.`
          : "Submit anyway, or look at it first."}
      </p>
      <div className="gap-gap flex justify-end">
        <Button variant="secondary" data-testid="critical-pause-follow-up" onClick={followUp}>
          {asked === null ? "Show the finding" : `Ask ${asked} about it`}
        </Button>
        <Button
          variant="primary"
          data-testid="critical-pause-submit"
          onClick={() => settledStore.setState({ [subjectKey]: pauseKey(criticals) })}
        >
          Submit review
        </Button>
      </div>
    </div>
  );
};
