/**
 * The Risk Summary in the risk column (Paper R1 1VV-0, 1WG-0; DESIGN.md, Review): the
 * Starlight reviewer tile with what ran, the four-cell Severity tally, the findings ranked
 * by Severity then confidence with Critical on top, the collapsed Dismissed and Resolved
 * groups, notes, and the quiet cost line. Comments without a line follow it.
 */
import type { Severity } from "@polaris/protocol";
import {
  Button,
  cn,
  Dither,
  EmptyState,
  harnessHue,
  PixelPolarisIcon,
  SEVERITIES,
  SeverityGlyph,
  Tile,
} from "@polaris/ui";
import { Match } from "effect";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { CommentsSection, CommentsSync, FeedbackCard } from "../../comments/index.ts";
import { modelLabel, useHarnessModels } from "../../harness/index.ts";
import {
  emptySurface,
  type ReviewSlotProps,
  subjectKey as keyOf,
  surfaceStore,
} from "../../review/index.ts";
import { useCanSummarise, useRiskRequest } from "../data/request.ts";
import { type RiskState, runRiskSummary, useRiskSummary } from "../data/riskStore.ts";
import {
  captionOf,
  costLine,
  type Finding,
  groupFindings,
  notesOf,
  type Summary,
} from "../model/summary.ts";
import { FindingItem } from "./FindingItem.tsx";

const TALLY_FILL: Readonly<Record<Severity, string>> = {
  critical: "bg-[color-mix(in_oklab,var(--color-severity-critical)_12%,transparent)]",
  high: "bg-[color-mix(in_oklab,var(--color-severity-high)_12%,transparent)]",
  medium: "bg-[color-mix(in_oklab,var(--color-severity-medium)_10%,transparent)]",
  low: "bg-[color-mix(in_oklab,var(--color-severity-low)_10%,transparent)]",
};

const Tally = ({ tally }: { readonly tally: Readonly<Record<Severity, number>> }) => (
  <div className="flex gap-1.5" data-testid="risk-tally">
    {SEVERITIES.map((severity) => {
      const n = tally[severity];

      return (
        <div
          key={severity}
          data-severity={severity}
          className={cn(
            "rounded-control h-tree-row flex flex-1 items-center justify-center gap-1.5",
            n === 0 ? "bg-surface-sunken text-text-faint" : TALLY_FILL[severity]
          )}
          style={n === 0 ? undefined : { color: `var(--color-severity-${severity}-text)` }}
        >
          {n === 0 ? (
            <SeverityGlyph severity={severity} className="opacity-40 grayscale" />
          ) : (
            <SeverityGlyph severity={severity} tone="text" />
          )}
          <span className="text-caption tabular font-medium">{n}</span>
        </div>
      );
    })}
  </div>
);

/** A fresh "1m ago" every minute while a summary is open. */
const useNow = () => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);

    return () => clearInterval(timer);
  }, []);

  return now;
};

const Header = ({
  state,
  onRerun,
}: {
  readonly state: RiskState;
  readonly onRerun: (() => void) | null;
}) => {
  const now = useNow();

  const running =
    state.kind === "starting" || (state.kind === "ready" && state.summary.status === "running");

  const caption = Match.value(state).pipe(
    Match.discriminatorsExhaustive("kind")({
      ready: ({ summary }) => captionOf(summary, now),
      failed: ({ message }) => `Couldn’t start: ${message}`,
      starting: () => "Starting…",
      waiting: () => "Runs once the change is checked out",
    })
  );

  return (
    <div className="gap-row-x flex items-center">
      <Tile hue="starlight" size={32}>
        <PixelPolarisIcon size={16} />
      </Tile>
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="text-heading-sm text-text-strong font-medium">Risk summary</span>
        <span
          className="text-caption text-text-subtle gap-gap flex items-center"
          data-testid="risk-caption"
        >
          {running && <Dither hue="starlight" size={12} moving />}
          <span className="truncate">{caption}</span>
        </span>
      </div>
      {onRerun !== null && (
        <Button size="xs" variant="ghost" onClick={onRerun}>
          Review again
        </Button>
      )}
    </div>
  );
};

const Group = ({
  label,
  findings,
  render,
}: {
  readonly label: string;
  readonly findings: ReadonlyArray<Finding>;
  readonly render: (f: Finding) => React.ReactNode;
}) => {
  const [open, setOpen] = useState(false);

  if (findings.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5" data-testid="risk-group" data-group={label}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="text-caption text-text-faint hover:text-text-subtle flex h-7 cursor-default items-center px-3"
      >
        {open ? "Hide" : "Show"} {label.toLowerCase()} · {findings.length}
      </button>
      {open && findings.map(render)}
    </div>
  );
};

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

const Findings = ({
  subjectKey,
  hostKey,
  summary,
}: {
  readonly subjectKey: string;
  readonly hostKey: string;
  readonly summary: Summary;
}) => {
  const selected = useStore(surfaceStore, (s) => (s[subjectKey] ?? emptySurface).selectedFinding);
  const groups = groupFindings(summary.findings);
  const names = useCostNames(hostKey, summary);
  const cost = costLine(summary, names);

  const item = (finding: Finding) => (
    <FindingItem
      key={finding.id}
      subjectKey={subjectKey}
      hostKey={hostKey}
      summary={summary}
      finding={finding}
      selected={selected === finding.id}
    />
  );

  return (
    <>
      <div className="px-panel pb-3">
        <Tally tally={groups.tally} />
      </div>
      <div className="px-gap flex flex-col gap-0.5" data-testid="risk-findings">
        {groups.listed.length === 0 && summary.status !== "running" && (
          <EmptyState
            className="py-6"
            icon={<PixelPolarisIcon size={24} />}
            title="Nothing flagged"
            fact="That isn’t a sign-off: read the diff before you approve"
          />
        )}
        {groups.listed.map(item)}
        <Group label="Dismissed" findings={groups.dismissed} render={item} />
        <Group label="Resolved" findings={groups.resolved} render={item} />
      </div>
      <div className="px-panel flex flex-col gap-1 pt-2">
        {notesOf(summary).map((note) => (
          <p key={note} className="text-caption text-text-subtle" data-testid="risk-note">
            {note}
          </p>
        ))}
        {cost !== null && (
          <p className="text-caption text-text-faint" data-testid="risk-cost">
            {cost}
          </p>
        )}
      </div>
    </>
  );
};

export const RiskColumnSlot = (props: ReviewSlotProps) => {
  const key = keyOf(props.subject);
  const request = useRiskRequest(props);
  const state = useRiskSummary(key, request);
  const capable = useCanSummarise(props);

  const rerun =
    request !== null &&
    state.kind !== "starting" &&
    !(state.kind === "ready" && state.summary.status === "running")
      ? () => void runRiskSummary(key, request, true)
      : null;

  return (
    <div
      className="flex max-h-[62%] min-h-0 shrink-0 flex-col overflow-x-hidden overflow-y-auto pb-3"
      data-testid="risk-summary"
      data-state={state.kind}
    >
      <CommentsSync {...props} />
      <div className="pt-panel px-panel pb-3">
        <Header
          state={state}
          onRerun={state.kind === "ready" || state.kind === "failed" ? rerun : null}
        />
      </div>
      {!capable.ok && (
        <p className="text-caption text-text-subtle px-panel pb-3">
          Risk summaries need a newer daemon on {capable.host}
        </p>
      )}
      {state.kind === "ready" && (
        <Findings subjectKey={key} hostKey={state.hostKey} summary={state.summary} />
      )}
      {props.subject.kind === "pull" ? (
        <CommentsSection subjectKey={key} />
      ) : (
        <FeedbackCard subjectKey={key} />
      )}
    </div>
  );
};
