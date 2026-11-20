/**
 * Intent (the rest) and Output (a rail, or a resizable panel) for the selected session, or one pane
 * spanning both for a new session or an empty Workspace. Features fill them
 * through the slots in app/slots.tsx.
 */
import type { SessionId } from "@polaris/protocol";
import type { SharedSessionRef } from "../routes/selection.ts";
import { Panel } from "@polaris/ui";
import { useRef } from "react";
import { slots } from "../app/slots.tsx";
import { HostStage } from "../features/empty/index.ts";
import { useStage, WaitingStage } from "../features/onboarding/index.ts";
import { PaneTerminal } from "../features/terminal/index.ts";
import { useApp, useSelection, useShellActions } from "./hooks.ts";
import { OutputLane } from "./OutputLane.tsx";

/** One panel spanning Intent and Output, ending 8px above the window's foot. */
const Pane = ({ children }: { readonly children: React.ReactNode }) => (
  <Panel asChild className="mb-2 min-w-0 flex-1">
    <section>{children}</section>
  </Panel>
);

/** A Workspace's pane with its terminal card rising under it, as in the Editor. */
const WorkspacePane = ({
  hostKey,
  workspaceId,
  children,
}: {
  readonly hostKey: string;
  readonly workspaceId: string;
  readonly children: React.ReactNode;
}) => (
  <section className="mb-2 flex min-h-0 min-w-0 flex-1">
    <PaneTerminal hostKey={hostKey} workspaceId={workspaceId}>
      {children}
    </PaneTerminal>
  </section>
);

/** A session shared with you: the owner's Workspace is known only by its id in the session. */
const SharedColumns = ({ hostKey, sessionId }: SharedSessionRef) => {
  const lane = useRef<HTMLDivElement>(null);

  const workspaceId = useApp(
    (s) => s.hostModels[hostKey]?.sessions.get(sessionId)?.session.workspaceId ?? null
  );

  return (
    <div ref={lane} className="flex min-w-0 flex-1 gap-2">
      <Panel asChild className="mb-2 min-w-[320px] flex-1">
        <section aria-label="Intent">
          <slots.SessionIntent hostKey={hostKey} sessionId={sessionId} />
        </section>
      </Panel>
      {workspaceId === null ? null : (
        <OutputLane hostKey={hostKey} workspaceId={workspaceId} sessionId={sessionId} lane={lane} />
      )}
    </div>
  );
};

export const Columns = () => {
  const { hostKey, workspaceId, sessionId, pane, shared } = useSelection();
  const { selectSession, closeNewSession } = useShellActions();

  const stage = useStage();
  const lane = useRef<HTMLDivElement>(null);

  if (shared !== null) return <SharedColumns {...shared} />;

  // No Workspace here: the setup (onboarding O2), also while a new session waits for "home".
  if (hostKey === null || workspaceId === null) {
    return <Pane>{stage === "waiting" ? <WaitingStage /> : <HostStage hostKey={hostKey} />}</Pane>;
  }

  if (pane === "new-session") {
    return (
      <WorkspacePane hostKey={hostKey} workspaceId={workspaceId}>
        <slots.NewSession
          hostKey={hostKey}
          workspaceId={workspaceId}
          onStarted={(id: SessionId) => selectSession({ hostKey, sessionId: id })}
          onCancel={closeNewSession}
        />
      </WorkspacePane>
    );
  }

  if (sessionId === null) {
    return (
      <WorkspacePane hostKey={hostKey} workspaceId={workspaceId}>
        <slots.NoSession hostKey={hostKey} workspaceId={workspaceId} />
      </WorkspacePane>
    );
  }

  return (
    <div ref={lane} className="flex min-w-0 flex-1 gap-2">
      <Panel asChild className="mb-2 min-w-[320px] flex-1">
        <section aria-label="Intent">
          <slots.SessionIntent hostKey={hostKey} sessionId={sessionId} />
        </section>
      </Panel>
      <OutputLane hostKey={hostKey} workspaceId={workspaceId} sessionId={sessionId} lane={lane} />
    </div>
  );
};
