/**
 * The Intent column for one Agent Session (Paper artboard 5): its header, the
 * live conversation and the composer. Output (the Turn's diff) is separate so
 * the shell can place the two regions.
 */
import {
  type ApprovalDecision,
  type ApprovalRequest,
  isKnownHarness,
  type SessionId,
} from "@polaris/protocol";
import type { Harness } from "@polaris/ui";
import { useState } from "react";
import { Commands } from "../../../commands.ts";
import { emptyHostModel } from "../../../store/hostModel.ts";
import type { SessionData } from "../../../store/plain.ts";
import { useApp, useShellActions } from "../../../shell/hooks.ts";
import { modelLabel, useHarnessModels } from "../../harness/index.ts";
import { InTerminalBar } from "../../terminal/index.ts";
import { send } from "../dispatch.ts";
import { useHost, useSession, hasCapability } from "../hooks.ts";
import { conversationRows } from "../model/conversation.ts";
import { tildePath } from "../model/format.ts";
import { composerMode, continueCommand, openQuestion, retryCommand } from "../model/intent.ts";
import { useOutbox } from "../outbox.ts";
import { showTurnDiff, toggleUnfolded, uiKey, useSessionUi } from "../state.ts";
import { Conversation } from "./Conversation.tsx";
import { ForkDialog, type ForkTarget } from "./ForkDialog.tsx";
import type { RowContext } from "./rows.tsx";
import { SessionComposer } from "./SessionComposer.tsx";
import { SessionHeader } from "./SessionHeader.tsx";
import { useSessionChrome } from "../chrome.ts";
import { EditorPlaceProvider } from "../../editor-links/index.ts";

/** The shell's session slot props (`app/slots.tsx`). */
export interface SessionViewProps {
  readonly hostKey: string;
  readonly sessionId: SessionId;
}

const useWhere = (hostKey: string, session: SessionData | null) => {
  const host = useHost(hostKey);
  const model = useApp((s) => s.hostModels[hostKey]) ?? emptyHostModel;

  if (session === null) return { where: "", branch: undefined };
  const workspace = model.workspaces.get(session.workspaceId);
  const worktree = session.worktreeId === null ? null : model.worktrees.get(session.worktreeId);
  const path = tildePath(session.cwd, host?.status.host?.homeDir ?? null);
  const parts = [host?.label, workspace?.name, path].filter((p) => p !== undefined);

  return { where: parts.join(" · "), branch: worktree?.branch ?? undefined };
};

const Placeholder = ({ children }: { readonly children: string }) => (
  <section className="text-body text-text-subtle grid flex-1 place-items-center">
    {children}
  </section>
);

export const SessionIntent = ({ hostKey, sessionId }: SessionViewProps) => {
  const { selectSession } = useShellActions();
  // A Fork opens once it exists; the shell owns selection.
  const onOpenSession = (id: SessionId) => selectSession({ hostKey, sessionId: id });
  const model = useSession(hostKey, sessionId);
  const key = uiKey(hostKey, sessionId);
  const ui = useSessionUi(key);
  const host = useHost(hostKey);
  const { where, branch } = useWhere(hostKey, model.session);
  const [forking, setForking] = useState<ForkTarget | null>(null);
  const chrome = useSessionChrome();
  const models = useHarnessModels(hostKey, model.session?.harness ?? "", model.session !== null);
  const { session } = model;

  const mode =
    session === null
      ? null
      : composerMode({
          state: session.state,
          lastTurn: model.turns.at(-1)?.turn.status ?? null,
          pendingApprovals: model.pendingApprovals.length,
          question: openQuestion(model.pendingApprovals),
          canSteer: hasCapability(host, "session.steer"),
        });

  const outbox = useOutbox({
    hostKey,
    uiKey: key,
    sessionId,
    model,
    ready: mode?.kind === "send",
    canSteer: mode?.kind === "steer",
  });

  if (session === null) return <Placeholder>Loading the session…</Placeholder>;
  const harness: Harness | null = isKnownHarness(session.harness) ? session.harness : null;
  const lastTurn = model.turns.at(-1)?.turn ?? null;
  const lastDone = model.turns.findLast((t) => t.turn.status !== "working")?.turn;

  const listed = conversationRows({
    setup: session.worktreeSetup,
    turns: model.turns,
    approvals: model.pendingApprovals,
    unfolded: ui.unfolded,
    outbox: ui.outbox,
  });

  const rows =
    chrome.trailer === undefined
      ? listed
      : [...listed, { kind: "trailer" as const, key: "trailer" }];

  const ctx: RowContext = {
    harness,
    state: session.state,
    liveTurnId: lastTurn?.status === "working" && session.state === "working" ? lastTurn.id : null,
    where,
    diff: { hostKey, cwd: session.cwd, sessionId },
    onToggleTurn: (turnId) => toggleUnfolded(key, turnId),
    onOpenDiff: (turnId) => showTurnDiff(key, turnId),
    onRespond: (request: ApprovalRequest, decision: ApprovalDecision) =>
      void send(
        hostKey,
        Commands.RespondToApproval({ sessionId, requestId: request.id, decision }),
        "Couldn't answer"
      ),
    onContinue: () => void send(hostKey, continueCommand(sessionId), "Couldn't continue"),
    onRetry: () => void send(hostKey, retryCommand(sessionId), "Couldn't retry"),
    modelLabel: (model, effort) => modelLabel(models.models, model, effort),
    canSteer: mode?.kind === "steer",
    outbox,
    chrome,
  };

  const place = { hostKey, root: session.cwd, workspaceId: session.workspaceId };

  return (
    <EditorPlaceProvider value={place}>
      <section
        aria-label={session.title}
        data-testid="session-panel"
        className="bg-bg flex h-full min-h-0 min-w-0 flex-col"
      >
        {chrome.header ?? (
          <SessionHeader
            hostKey={hostKey}
            session={session}
            harness={harness}
            turnNumber={lastTurn === null ? null : lastTurn.index + 1}
            canFork={
              harness !== null && lastDone !== undefined && hasCapability(host, "session.fork")
            }
            onFork={() => {
              if (harness === null || lastDone === undefined) return;
              setForking({
                sessionId,
                turnId: lastDone.id,
                turnNumber: lastDone.index + 1,
                harness,
                model: session.model,
                effort: session.effort,
              });
            }}
          />
        )}
        {chrome.body ?? <Conversation scrollKey={key} rows={rows} ctx={ctx} />}
        <InTerminalBar
          session={{
            hostKey,
            workspaceId: session.workspaceId,
            sessionId,
            state: session.state,
            title: session.title === "" ? session.harness : session.title,
          }}
        />
        {harness === null ? null : (
          <SessionComposer
            hostKey={hostKey}
            uiKey={key}
            harness={harness}
            session={session}
            model={model}
            branch={branch}
            onOpenSession={onOpenSession}
            outbox={outbox}
          />
        )}
        <ForkDialog
          hostKey={hostKey}
          target={forking}
          onClose={() => setForking(null)}
          onForked={onOpenSession}
        />
      </section>
    </EditorPlaceProvider>
  );
};
