/**
 * Intent (the rest) and Output (a rail, or a resizable panel) for the selected session, or one pane
 * spanning both for a new session or an empty Workspace. Features fill them
 * through the slots in app/slots.tsx.
 */
import type { SessionId } from "@polaris/protocol";
import { Panel } from "@polaris/ui";
import { useRef } from "react";
import { slots } from "../app/slots.tsx";
import { HostStage } from "../features/empty/index.ts";
import { useStage, WaitingStage } from "../features/onboarding/index.ts";
import { TerminalDock } from "../features/terminal/index.ts";
import { useSelection, useShellActions } from "./hooks.ts";
import { OutputLane } from "./OutputLane.tsx";

/** One panel spanning Intent and Output, ending 8px above the window's foot. */
const Pane = ({ children }: { readonly children: React.ReactNode }) => (
  <Panel asChild className="mb-2 min-w-0 flex-1">
    <section>{children}</section>
  </Panel>
);

export const Columns = () => {
  const { hostKey, workspaceId, sessionId, pane } = useSelection();
  const { selectSession, closeNewSession } = useShellActions();

  const stage = useStage();
  const lane = useRef<HTMLDivElement>(null);

  // No Workspace here: the setup (onboarding O2), also while a new session waits for "home".
  if (hostKey === null || workspaceId === null) {
    return <Pane>{stage === "waiting" ? <WaitingStage /> : <HostStage hostKey={hostKey} />}</Pane>;
  }

  if (pane === "new-session") {
    return (
      <Pane>
        <slots.NewSession
          hostKey={hostKey}
          workspaceId={workspaceId}
          onStarted={(id: SessionId) => selectSession({ hostKey, sessionId: id })}
          onCancel={closeNewSession}
        />
      </Pane>
    );
  }

  if (sessionId === null) {
    return (
      <Pane>
        <TerminalDock hostKey={hostKey} workspaceId={workspaceId}>
          <slots.NoSession hostKey={hostKey} workspaceId={workspaceId} />
        </TerminalDock>
      </Pane>
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
