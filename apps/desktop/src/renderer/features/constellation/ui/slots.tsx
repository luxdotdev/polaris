/**
 * The shell's session slots, Constellation-aware: a Lead's Intent swaps to a focused worker
 * or handover and shows digest cards; its Output gains the Constellation tab; a worker's
 * Intent shows its brief and Claim.
 */
import type { SessionId } from "@polaris/protocol";
import { Button, cn, ChevronRightIcon, IconButton, Kbd } from "@polaris/ui";
import { type ReactNode, useEffect } from "react";
import { useApp, useCommands } from "../../../shell/hooks.ts";
import {
  hideOutput,
  offerOutput,
  type SessionChrome,
  SessionChromeContext,
  SessionIntent,
  SessionOutput,
} from "../../session/index.ts";
import { useFacts, useLeadConstellation, useWorkerAttempt, type WorkerAttempt } from "../hooks.ts";
import type { ConstellationRecord } from "../model/index.ts";
import { leadKey, patchLeadUi, useLeadUi } from "../state.ts";
import { DigestCard } from "./cards.tsx";
import { ConstellationTab } from "./ConstellationTab.tsx";
import { HandoverFocus, useWorkerChrome, WorkerFocus } from "./focus.tsx";

export interface SessionSlot {
  readonly hostKey: string;
  readonly sessionId: SessionId;
}

const useTitle = (hostKey: string, sessionId: string) =>
  useApp((s) => s.hostModels[hostKey]?.sessions.get(sessionId)?.session.title ?? "the lead");

const LeadIntent = ({
  hostKey,
  sessionId,
  record,
}: SessionSlot & { readonly record: ConstellationRecord }) => {
  const ui = useLeadUi(leadKey(hostKey, sessionId));
  const leadTitle = useTitle(hostKey, sessionId);
  const facts = useFacts(record);
  const digests = new Map(record.digests.map((d) => [d.turnId, d]));

  // A Lead's Output holds its Constellation: open it unless the user chose otherwise.
  useEffect(() => offerOutput(hostKey, sessionId), [hostKey, sessionId]);

  if (ui.focus?.kind === "task")
    return (
      <WorkerFocus
        leadHostKey={hostKey}
        record={record}
        taskId={ui.focus.taskId}
        leadTitle={leadTitle}
      />
    );

  if (ui.focus?.kind === "handover")
    return (
      <HandoverFocus
        leadHostKey={hostKey}
        record={record}
        revision={ui.focus.revision}
        leadTitle={leadTitle}
      />
    );

  const chrome: SessionChrome = {
    promptCard: ({ turnId }) => {
      const digest = digests.get(turnId);

      return digest === undefined ? null : (
        <DigestCard record={record} digest={digest} facts={facts} />
      );
    },
  };

  return (
    <SessionChromeContext.Provider value={chrome}>
      <SessionIntent hostKey={hostKey} sessionId={sessionId} />
    </SessionChromeContext.Provider>
  );
};

const WorkerIntent = ({
  hostKey,
  sessionId,
  worker,
}: SessionSlot & { readonly worker: WorkerAttempt }) => {
  const leadTitle = useTitle(worker.leadHostKey, worker.view.constellation.leadSessionId);

  const chrome = useWorkerChrome({
    leadHostKey: worker.leadHostKey,
    record: worker.view,
    task: worker.task,
    attempt: worker.attempt,
    leadTitle,
  });

  return (
    <SessionChromeContext.Provider value={chrome}>
      <SessionIntent hostKey={hostKey} sessionId={sessionId} />
    </SessionChromeContext.Provider>
  );
};

/** The `SessionIntent` slot. */
export const ConstellationIntent = ({ hostKey, sessionId }: SessionSlot) => {
  const lead = useLeadConstellation(hostKey, sessionId);
  const worker = useWorkerAttempt(hostKey, sessionId);

  if (lead !== null) return <LeadIntent hostKey={hostKey} sessionId={sessionId} record={lead} />;

  if (worker !== null)
    return <WorkerIntent hostKey={hostKey} sessionId={sessionId} worker={worker} />;

  return <SessionIntent hostKey={hostKey} sessionId={sessionId} />;
};

const Tab = ({
  id,
  on,
  onClick,
  children,
}: {
  readonly id: string;
  readonly on: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) => (
  <Button
    variant={on ? "secondary" : "ghost"}
    className={cn(on && "text-text-strong")}
    aria-pressed={on}
    onClick={onClick}
    data-testid={`output-tab-${id}`}
  >
    {children}
  </Button>
);

/** The `SessionOutput` slot: a Lead's Output has the Constellation tab first. */
export const ConstellationOutput = ({ hostKey, sessionId }: SessionSlot) => {
  const record = useLeadConstellation(hostKey, sessionId);
  const key = leadKey(hostKey, sessionId);
  const ui = useLeadUi(key);
  const commands = useCommands();

  const workspaceId = useApp(
    (s) => s.hostModels[hostKey]?.sessions.get(sessionId)?.session.workspaceId
  );

  if (record === null) return <SessionOutput hostKey={hostKey} sessionId={sessionId} />;

  const tabs = (
    <>
      <Tab
        id="constellation"
        on={ui.tab === "constellation"}
        onClick={() => patchLeadUi(key, () => ({ tab: "constellation" }))}
      >
        Constellation
      </Tab>
      <Tab
        id="changes"
        on={ui.tab === "changes"}
        onClick={() => patchLeadUi(key, () => ({ tab: "changes" }))}
      >
        Changes
      </Tab>
    </>
  );

  if (ui.tab === "changes")
    return <SessionOutput hostKey={hostKey} sessionId={sessionId} tabs={tabs} />;

  return (
    <section
      aria-label="Output"
      className="bg-bg flex h-full min-h-0 min-w-0 flex-col"
      data-testid="session-output"
    >
      <div className="border-hairline flex h-11 shrink-0 items-center gap-1 border-b px-3">
        {tabs}
        <span className="flex-1" />
        {ui.focus?.kind === "task" ? (
          <Button
            variant="secondary"
            onClick={() => {
              patchLeadUi(key, () => ({ focus: null, review: null }));
              commands.run("session.focusComposer");
            }}
          >
            Message lead
            <Kbd variant="plain">M</Kbd>
          </Button>
        ) : null}
        {workspaceId === undefined ? null : (
          <IconButton
            size="sm"
            label="Hide output"
            icon={<ChevronRightIcon size={14} />}
            onClick={() => hideOutput({ hostKey, workspaceId }, sessionId)}
          />
        )}
      </div>
      <ConstellationTab hostKey={hostKey} record={record} />
    </section>
  );
};
