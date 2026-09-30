/**
 * Intent (448px) and Output (the rest) for the selected session, or one pane
 * spanning both for a new session or an empty Workspace. Features fill them
 * through the slots in app/slots.tsx.
 */
import type { SessionId } from "@polaris/protocol";
import { slots } from "../app/slots.tsx";
import { HostStage } from "../features/empty/index.ts";
import { useStage, WaitingStage } from "../features/onboarding/index.ts";
import { TerminalDock } from "../features/terminal/index.ts";
import { useSelection, useShellActions } from "./hooks.ts";

export const Columns = () => {
  const { hostKey, workspaceId, sessionId, pane } = useSelection();
  const { selectSession, closeNewSession } = useShellActions();

  const stage = useStage();

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
    <>
      <section
        aria-label="Intent"
        className="border-hairline flex w-[448px] min-w-[320px] shrink flex-col border-r"
      >
        <slots.SessionIntent hostKey={hostKey} sessionId={sessionId} />
      </section>
      <section aria-label="Output" className="flex min-w-0 flex-1 flex-col">
        <TerminalDock hostKey={hostKey} workspaceId={workspaceId}>
          <slots.SessionOutput hostKey={hostKey} sessionId={sessionId} />
        </TerminalDock>
      </section>
    </>
  );
};
