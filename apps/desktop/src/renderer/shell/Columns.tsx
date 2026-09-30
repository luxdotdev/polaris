/**
 * Intent (the rest) and Output (a rail, or a resizable panel) for the selected session, or one pane
 * spanning both for a new session or an empty Workspace. Features fill them
 * through the slots in app/slots.tsx.
 */
import type { SessionId } from "@polaris/protocol";
import { useRef } from "react";
import { slots } from "../app/slots.tsx";
import { HostStage } from "../features/empty/index.ts";
import { useStage, WaitingStage } from "../features/onboarding/index.ts";
import { TerminalDock } from "../features/terminal/index.ts";
import { useSelection, useShellActions } from "./hooks.ts";
import { OutputLane } from "./OutputLane.tsx";

export const Columns = () => {
  const { hostKey, workspaceId, sessionId, pane } = useSelection();
  const { selectSession, closeNewSession } = useShellActions();

  const stage = useStage();
  const lane = useRef<HTMLDivElement>(null);

  // No Workspace here: the setup (onboarding O2), also while a new session waits for "home".
  if (hostKey === null || workspaceId === null) {
    return (
      <section className="flex min-w-0 flex-1 flex-col">
        {stage === "waiting" ? <WaitingStage /> : <HostStage hostKey={hostKey} />}
      </section>
    );
  }

  if (pane === "new-session") {
    return (
      <section className="flex min-w-0 flex-1 flex-col">
        <slots.NewSession
          hostKey={hostKey}
          workspaceId={workspaceId}
          onStarted={(id: SessionId) => selectSession({ hostKey, sessionId: id })}
          onCancel={closeNewSession}
        />
      </section>
    );
  }

  if (sessionId === null) {
    return (
      <section className="flex min-w-0 flex-1 flex-col">
        <TerminalDock hostKey={hostKey} workspaceId={workspaceId}>
          <slots.NoSession hostKey={hostKey} workspaceId={workspaceId} />
        </TerminalDock>
      </section>
    );
  }

  return (
    <div ref={lane} className="flex min-w-0 flex-1">
      <section
        aria-label="Intent"
        className="border-hairline flex min-w-[320px] flex-1 flex-col border-r"
      >
        <slots.SessionIntent hostKey={hostKey} sessionId={sessionId} />
      </section>
      <OutputLane hostKey={hostKey} workspaceId={workspaceId} sessionId={sessionId} lane={lane} />
    </div>
  );
};
