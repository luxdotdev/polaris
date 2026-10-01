/**
 * The focus swap (DESIGN.md): the Lead's Intent column shows a worker's live session (C2, C3)
 * or the handover summary (C9); a breadcrumb leads back. The graph stays put.
 */
import { isKnownHarness, MessageTarget } from "@polaris/protocol";
import { ChevronLeftIcon, ChevronRightIcon, HarnessMark } from "@polaris/ui";
import type { ReactNode } from "react";
import { openSessionReview } from "../../../routes/review.ts";
import { useApp, useShellActions } from "../../../shell/hooks.ts";
import { type SessionChrome, SessionChromeContext, SessionIntent } from "../../session/index.ts";
import { constellationCommands } from "../client.ts";
import { useFacts } from "../hooks.ts";
import { hostKeyOf } from "../liveFacts.ts";
import {
  type AttemptData,
  type ConstellationRecord,
  idRanges,
  latestAttempts,
  span,
  type TaskData,
} from "../model/index.ts";
import { leadKey, patchLeadUi, type ReviewMode, useLeadUi } from "../state.ts";
import { BriefCard } from "./cards.tsx";
import { ClaimCard } from "./claim.tsx";
import { HandoverBody } from "./handover.tsx";

const Crumbs = ({
  items,
  onBack,
}: {
  readonly items: ReadonlyArray<string>;
  readonly onBack: () => void;
}) => (
  <nav
    aria-label="Breadcrumb"
    className="text-body text-text-subtle flex min-w-0 items-center gap-1.5"
  >
    <button
      type="button"
      onClick={onBack}
      className="hover:text-text-default flex min-w-0 cursor-default items-center gap-1.5"
    >
      <ChevronLeftIcon size={12} />
      <span className="truncate">{items[0]}</span>
    </button>
    {items.slice(1).map((item, n) => (
      <span key={`${item}${n}`} className="flex min-w-0 items-center gap-1.5">
        <ChevronRightIcon size={10} className="text-text-faint shrink-0" />
        <span className={n === items.length - 2 ? "text-text-default truncate" : "truncate"}>
          {item}
        </span>
      </span>
    ))}
  </nav>
);

export const FocusHeader = ({
  crumbs,
  onBack,
  title,
  harness,
  status,
  aside,
}: {
  readonly crumbs: ReadonlyArray<string>;
  readonly onBack: () => void;
  readonly title: string;
  readonly harness: string | null;
  readonly status: ReactNode;
  readonly aside: ReactNode;
}) => (
  <header
    className="border-hairline pt-panel flex shrink-0 flex-col gap-2 border-b px-5 pb-3.5"
    data-testid="focus-header"
  >
    <Crumbs items={crumbs} onBack={onBack} />
    <h1 className="text-title text-text-strong truncate">{title}</h1>
    <div className="flex min-w-0 items-center gap-3 whitespace-nowrap">
      {harness !== null && isKnownHarness(harness) ? (
        <HarnessMark harness={harness} named className="shrink-0" />
      ) : null}
      <span className="text-caption text-text-subtle tabular min-w-0 truncate">{status}</span>
      <span className="flex-1" />
      <span className="text-caption text-text-subtle shrink-0">{aside}</span>
    </div>
  </header>
);

const STATUS: Readonly<Record<AttemptData["state"], string>> = {
  working: "Working",
  review: "In review",
  accepted: "Accepted",
  rejected: "Sent back",
  lost: "Lost",
  settled_unverified: "Settled unverified",
  failed: "Failed",
};

/** The worker session's first Turn on or after this Attempt began: its brief. */
const useBriefTurn = (hostKey: string | null, attempt: AttemptData) =>
  useApp((s) => {
    if (hostKey === null) return null;
    const model = s.sessions[`${hostKey}\u0000${attempt.sessionId}`];

    return model?.turns.find((t) => t.turn.startedAt >= attempt.startedAt)?.turn.id ?? null;
  });

export interface WorkerChromeInput {
  readonly leadHostKey: string;
  readonly record: ConstellationRecord;
  readonly task: TaskData;
  readonly attempt: AttemptData;
  readonly leadTitle: string;
}

/** Brief and Claim cards for a worker session, focused or opened from the sidebar. */
export const useWorkerChrome = (input: WorkerChromeInput): SessionChrome => {
  const { leadHostKey, record, task, attempt, leadTitle } = input;
  const c = record.constellation;
  const hosts = useApp((s) => s.hosts);
  const workerHost = hostKeyOf(hosts, attempt.hostId);
  const briefTurn = useBriefTurn(workerHost, attempt);
  const facts = useFacts(record);
  const key = leadKey(leadHostKey, c.leadSessionId);
  const ui = useLeadUi(key);
  const shell = useShellActions();
  const latest = latestAttempts(c);
  const accepted = task.deps.filter((d) => latest.get(d)?.state === "accepted");
  const handed = facts.handedUp.has(attempt.id);
  const review = ui.review?.attemptId === attempt.id ? ui.review.mode : null;

  const openInReview = () => {
    if (workerHost !== null) openSessionReview(shell, workerHost, attempt.sessionId);
  };

  return {
    promptCard: ({ turnId, folded, onToggle }) =>
      turnId === briefTurn ? (
        <BriefCard
          leadTitle={leadTitle}
          task={task}
          attempt={attempt}
          accepted={accepted}
          folded={folded || attempt.claim != null}
          onToggle={onToggle}
        />
      ) : null,
    trailer:
      attempt.claim == null ? undefined : (
        <ClaimCard
          hostKey={leadHostKey}
          record={record}
          task={task}
          attempt={attempt}
          facts={facts}
          yours={handed || c.state === "paused"}
          handed={handed}
          review={review}
          onReview={(mode: ReviewMode | null) =>
            patchLeadUi(key, () => ({
              review: mode === null ? null : { attemptId: attempt.id, mode },
            }))
          }
          onOpenInReview={openInReview}
          menu={null}
          leadMark={
            facts.lead.harness === null || !isKnownHarness(facts.lead.harness) ? null : (
              <HarnessMark harness={facts.lead.harness} size={18} />
            )
          }
        />
      ),
  };
};

export const WorkerFocus = ({
  leadHostKey,
  record,
  taskId,
  leadTitle,
}: {
  readonly leadHostKey: string;
  readonly record: ConstellationRecord;
  readonly taskId: string;
  readonly leadTitle: string;
}) => {
  const c = record.constellation;
  const task = c.tasks.find((t) => t.id === taskId);
  const attempt = c.attempts.findLast((a) => a.taskId === taskId) ?? null;

  if (task === undefined || attempt === null)
    return (
      <FocusMissing
        onBack={() => patchLeadUi(leadKey(leadHostKey, c.leadSessionId), () => ({ focus: null }))}
      />
    );

  return (
    <WorkerFocusOn
      leadHostKey={leadHostKey}
      record={record}
      task={task}
      attempt={attempt}
      leadTitle={leadTitle}
    />
  );
};

const FocusMissing = ({ onBack }: { readonly onBack: () => void }) => (
  <section className="text-body text-text-subtle grid flex-1 place-items-center">
    <button type="button" onClick={onBack} className="cursor-default">
      This task has no attempt yet · back to the lead
    </button>
  </section>
);

const WorkerFocusOn = ({ leadHostKey, record, task, attempt, leadTitle }: WorkerChromeInput) => {
  const c = record.constellation;
  const key = leadKey(leadHostKey, c.leadSessionId);
  const hosts = useApp((s) => s.hosts);
  const workerHost = hostKeyOf(hosts, attempt.hostId);
  const facts = useFacts(record);
  const worker = facts.worker(attempt);
  const number = c.attempts.filter((a) => a.taskId === task.id).length;
  const cards = useWorkerChrome({ leadHostKey, record, task, attempt, leadTitle });
  const back = () => patchLeadUi(key, () => ({ focus: null, review: null }));

  const chrome: SessionChrome = {
    ...cards,
    header: (
      <FocusHeader
        crumbs={[leadTitle, task.group ?? c.name, task.id]}
        onBack={back}
        title={`${task.id} · ${task.title}`}
        harness={worker.harness}
        status={`${STATUS[attempt.state]} · attempt ${number} · ${span(attempt.startedAt, facts.now)}`}
        aside={task.deps.length === 0 ? null : `after ${idRanges(task.deps)}`}
      />
    ),
    composer: {
      placeholder: `Steer ${task.id} directly · reported to the lead`,
      onSubmit: (text) =>
        constellationCommands.message(
          leadHostKey,
          {
            constellationId: c.id,
            target: MessageTarget.cases.Worker.make({ attemptId: attempt.id }),
            text,
            authority: "conversation",
          },
          `Couldn't steer ${task.id}`
        ),
    },
  };

  if (workerHost === null) return <FocusMissing onBack={back} />;

  return (
    <SessionChromeContext.Provider value={chrome}>
      <SessionIntent hostKey={workerHost} sessionId={attempt.sessionId} />
    </SessionChromeContext.Provider>
  );
};

export const HandoverFocus = ({
  leadHostKey,
  record,
  revision,
  leadTitle,
}: {
  readonly leadHostKey: string;
  readonly record: ConstellationRecord;
  readonly revision: number;
  readonly leadTitle: string;
}) => {
  const c = record.constellation;
  const key = leadKey(leadHostKey, c.leadSessionId);
  const handover = record.handovers.find((h) => h.revision === revision) ?? null;
  const facts = useFacts(record);
  const back = () => patchLeadUi(key, () => ({ focus: null }));

  if (handover === null) return <FocusMissing onBack={back} />;

  const chrome: SessionChrome = {
    header: (
      <FocusHeader
        crumbs={[leadTitle, c.name, "Handover"]}
        onBack={back}
        title={`Handed to a new lead at ${new Date(handover.at).toTimeString().slice(0, 5)}`}
        harness={facts.lead.harness}
        status="previous lead → this session"
        aside={`atomic · rev ${handover.revision}`}
      />
    ),
    body: (
      <HandoverBody leadHostKey={leadHostKey} record={record} handover={handover} facts={facts} />
    ),
  };

  return (
    <SessionChromeContext.Provider value={chrome}>
      <SessionIntent hostKey={leadHostKey} sessionId={c.leadSessionId} />
    </SessionChromeContext.Provider>
  );
};
