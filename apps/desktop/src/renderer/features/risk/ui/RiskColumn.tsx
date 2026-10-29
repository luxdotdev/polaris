/**
 * The Risk Summary card in the risk panel (Paper X-G; DESIGN.md, Review): the Starlight
 * reviewer tile with what ran and Rerun, the readout well, the findings ranked by Severity
 * then confidence with Critical on top, the collapsed Dismissed and Resolved groups and
 * notes; comments without a line follow. While the Reviewer chats, its conversation stands
 * in for the findings. The composer, Walkthrough and status line are its foot (`RiskFooter`).
 */
import {
  Button,
  ChevronLeftIcon,
  Dither,
  EmptyState,
  KICKER,
  PixelPolarisIcon,
  Tile,
} from "@polaris/ui";
import { Match } from "effect";
import { Fragment, type ReactNode, useEffect, useState } from "react";
import { useStore } from "zustand";
import { useApp, useShellActions } from "../../../shell/hooks.ts";
import { setChatting, useChatting } from "../data/ui.ts";
import { Conversation, reviewerName } from "./AskReviewer.tsx";
import { Readout } from "./Readout.tsx";
import { isWindowsHost } from "../../../shell/hostPlatform.ts";
import { CommentsSection, CommentsSync, FeedbackCard } from "../../comments/index.ts";
import {
  emptySurface,
  type ReviewSlotProps,
  subjectKey as keyOf,
  surfaceStore,
} from "../../review/index.ts";
import { AlsoReviewed } from "../../review/overview/index.ts";
import { useCanSummarise, useRiskRequest } from "../data/request.ts";
import { type RiskState, runRiskSummary, useRiskSummary } from "../data/riskStore.ts";
import {
  captionOf,
  type Finding,
  groupFindings,
  notesOf,
  rerunLabel,
  type Summary,
} from "../model/summary.ts";
import { FindingItem } from "./FindingItem.tsx";

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
          <span className="line-clamp-2">{caption}</span>
        </span>
      </div>
      {onRerun !== null && (
        <Button size="xs" variant="ghost" data-testid="risk-rerun" onClick={onRerun}>
          {rerunLabel(state.kind === "ready" ? state.summary : null)}
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
        className="text-caption text-text-subtle hover:text-text-default flex h-7 cursor-default items-center px-3"
      >
        {open ? "Hide" : "Show"} {label.toLowerCase()} · {findings.length}
      </button>
      {open && findings.map(render)}
    </div>
  );
};

const Findings = ({
  subjectKey,
  hostKey,
  summary,
  after,
}: {
  readonly subjectKey: string;
  readonly hostKey: string;
  readonly summary: Summary;
  /** Over the findings: a review bot's verdict ("Also reviewed by Suzuka"). */
  readonly after?: ReactNode;
}) => {
  const selected = useStore(surfaceStore, (s) => (s[subjectKey] ?? emptySurface).selectedFinding);
  const windowsHost = useApp((s) => isWindowsHost(s.hosts.find((h) => h.key === hostKey)));
  const groups = groupFindings(summary.findings);

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
      {after !== undefined && <div className="px-panel">{after}</div>}
      <div className="px-gap flex flex-col gap-0.5 pt-3" data-testid="risk-findings">
        {groups.listed.length === 0 && summary.status !== "running" && (
          <EmptyState
            className="py-6"
            icon={<PixelPolarisIcon size={24} />}
            title="Nothing flagged"
            fact="That isn’t a sign-off: read the diff before you approve"
          />
        )}
        {groups.listed.map((finding, i) => (
          <Fragment key={finding.id}>
            {i > 0 && groups.listed[i - 1]?.severity !== finding.severity && (
              <div aria-hidden className="bg-hairline mx-3 my-1 h-px" />
            )}
            {item(finding)}
          </Fragment>
        ))}
        <Group label="Dismissed" findings={groups.dismissed} render={item} />
        <Group label="Resolved" findings={groups.resolved} render={item} />
      </div>
      <div className="px-panel flex flex-col gap-1 pt-2">
        {notesOf(summary, windowsHost).map((note) => (
          <p key={note} className="text-caption text-text-subtle" data-testid="risk-note">
            {note}
          </p>
        ))}
      </div>
    </>
  );
};

/** While chatting: back to the findings, the open criticals, and who is being asked. */
const ChatHeader = ({
  subjectKey,
  summary,
}: {
  readonly subjectKey: string;
  readonly summary: Summary;
}) => {
  const critical = groupFindings(summary.findings).listed.filter(
    (f) => f.severity === "critical" && f.status === "open"
  ).length;

  return (
    <div
      className="px-panel flex shrink-0 flex-col gap-2.5 pt-3 pb-3"
      data-testid="risk-chat-header"
    >
      <div className="flex items-center">
        <Button
          size="xs"
          variant="secondary"
          className="gap-1 rounded-full"
          data-testid="risk-back-to-findings"
          onClick={() => setChatting(subjectKey, false)}
        >
          <ChevronLeftIcon size={10} />
          Findings
        </Button>
        <span className="flex-1" />
        {critical > 0 && (
          <span className={KICKER} style={{ color: "var(--color-severity-critical-text)" }}>
            {critical} critical open
          </span>
        )}
      </div>
      <div className="gap-gap flex items-center">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{
            background:
              summary.reviewer === null
                ? "var(--color-starlight)"
                : `var(--color-harness-${summary.reviewer.harness})`,
          }}
        />
        <span className="text-heading-sm text-text-strong font-medium">
          Asking {reviewerName(summary)}
        </span>
        <span className="text-caption text-text-subtle">· Risk summary</span>
      </div>
    </div>
  );
};

export const RiskColumnSlot = (props: ReviewSlotProps) => {
  const key = keyOf(props.subject);
  const request = useRiskRequest(props);
  const state = useRiskSummary(key, request);
  const capable = useCanSummarise(props);
  const { openSettings } = useShellActions();
  const chatting = useChatting(key) && state.kind === "ready";

  const rerun =
    request !== null &&
    state.kind !== "starting" &&
    !(state.kind === "ready" && state.summary.status === "running")
      ? () => void runRiskSummary(key, request, true)
      : null;

  // The header and readout stay put; only the findings (or the conversation) scroll.
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="risk-summary"
      data-state={state.kind}
      data-chatting={chatting ? "" : undefined}
    >
      <CommentsSync {...props} />
      {chatting ? (
        <ChatHeader subjectKey={key} summary={state.summary} />
      ) : (
        <>
          <div className="px-panel shrink-0 pt-4 pb-3">
            <Header
              state={state}
              onRerun={state.kind === "ready" || state.kind === "failed" ? rerun : null}
            />
          </div>
          {state.kind === "ready" && (
            <Readout tally={groupFindings(state.summary.findings).tally} />
          )}
        </>
      )}
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto" data-testid="risk-scroll">
        {!capable.ok && (
          <p className="text-caption text-text-subtle px-panel pt-3">
            Risk summaries need a newer daemon on {capable.host} ·{" "}
            <button
              type="button"
              onClick={() => openSettings("hosts")}
              className="text-text-default cursor-default hover:underline"
            >
              Upgrade daemon
            </button>
          </p>
        )}
        {state.kind === "ready" &&
          (chatting ? (
            <Conversation subjectKey={key} hostKey={state.hostKey} summary={state.summary} />
          ) : (
            <Findings
              subjectKey={key}
              hostKey={state.hostKey}
              summary={state.summary}
              after={<AlsoReviewed subject={props.subject} />}
            />
          ))}
        {!chatting && props.subject.kind === "pull" && <CommentsSection subjectKey={key} />}
      </div>
      {props.subject.kind === "session" && (
        <div className="shrink-0">
          <FeedbackCard subjectKey={key} />
        </div>
      )}
    </div>
  );
};
