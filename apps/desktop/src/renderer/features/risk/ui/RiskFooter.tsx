/**
 * The Risk Summary card's foot (Paper X-G): the slim composer to ask the Reviewer, the
 * Walkthrough entry (not while chatting), and the footer bar: a mono status line, the
 * Reviewer's cost line (ENG-229) and its one action, choosing or changing the Reviewer.
 */
import { Button, harnessHue, Kicker, EditorIcon } from "@polaris/ui";
import { useStore } from "zustand";
import { useShellActions } from "../../../shell/hooks.ts";
import { modelLabel, useHarnessModels } from "../../harness/index.ts";
import {
  emptySurface,
  type ReviewSlotProps,
  subjectKey as keyOf,
  surfaceStore,
} from "../../review/index.ts";
import { setTab } from "../../review/overview/index.ts";
import { useRisk } from "../data/riskStore.ts";
import { useChatting } from "../data/ui.ts";
import {
  footerStatus,
  groupFindings,
  reviewerLine,
  reviewerState,
  type Summary,
  walkthroughLine,
} from "../model/summary.ts";
import { AskReviewer } from "./AskReviewer.tsx";

const useCostNames = (hostKey: string, summary: Summary) => {
  const harness = summary.reviewer?.harness ?? "codex";
  const { models } = useHarnessModels(hostKey, harness, summary.reviewer !== null);

  if (summary.reviewer === null) return null;

  return {
    harness: harnessHue(harness).name,
    model:
      summary.reviewer.model === null
        ? null
        : modelLabel(models, summary.reviewer.model, summary.reviewer.effort),
  };
};

const WalkthroughEntry = ({
  subjectKey,
  summary,
}: {
  readonly subjectKey: string;
  readonly summary: Summary;
}) => {
  const line = walkthroughLine(summary.walkthrough);

  if (line === null) return null;

  return (
    <div className="shrink-0 px-3 pt-2" data-testid="risk-walkthrough">
      <button
        type="button"
        onClick={() => setTab(subjectKey, "overview")}
        className="rounded-card border-hairline hover:bg-fill-hover gap-row-x flex w-full cursor-default items-center border px-3 py-2.5 text-left"
      >
        <EditorIcon size={14} className="text-text-subtle shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="text-body text-text-default font-medium">Walkthrough</span>
          <span className="text-caption text-text-subtle truncate">{line}</span>
        </span>
        <span className="text-caption text-text-subtle shrink-0">Overview →</span>
      </button>
    </div>
  );
};

const FooterBar = ({
  subjectKey,
  hostKey,
  summary,
}: {
  readonly subjectKey: string;
  readonly hostKey: string;
  readonly summary: Summary;
}) => {
  const { openSettings } = useShellActions();
  const names = useCostNames(hostKey, summary);
  const files = useStore(surfaceStore, (s) => (s[subjectKey] ?? emptySurface).paths.length);
  const status = footerStatus(files, groupFindings(summary.findings));
  const cost = reviewerLine(summary, names);

  return (
    <footer
      className="border-hairline bg-ground/40 mt-3 flex min-h-14 shrink-0 items-center gap-2.5 border-t py-2 pr-2.5 pl-4"
      data-testid="risk-footer"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Kicker className="truncate" data-testid="risk-status" title={status}>
          {status}
        </Kicker>
        {summary.status !== "running" && (
          <p
            className="text-caption text-text-subtle truncate"
            data-testid="risk-cost"
            title={cost}
          >
            {cost}
          </p>
        )}
      </div>
      <Button
        size="xs"
        variant="ghost"
        className="shrink-0"
        data-testid="risk-reviewer-settings"
        onClick={() => openSettings("reviewer")}
      >
        {reviewerState(summary) === "none" ? "Choose a reviewer" : "Change"}
      </Button>
    </footer>
  );
};

export const RiskFooterSlot = (props: ReviewSlotProps) => {
  const key = keyOf(props.subject);
  const state = useRisk(key);
  const chatting = useChatting(key);

  if (state.kind !== "ready") return null;

  return (
    <div className="flex shrink-0 flex-col">
      <AskReviewer subjectKey={key} hostKey={state.hostKey} summary={state.summary} />
      {!chatting && <WalkthroughEntry subjectKey={key} summary={state.summary} />}
      <FooterBar subjectKey={key} hostKey={state.hostKey} summary={state.summary} />
    </div>
  );
};
