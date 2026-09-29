/**
 * Intent (448px) and Output (the rest) for the selected session, or one pane
 * spanning both for a new session or an empty Workspace. Features fill them
 * through the slots in app/slots.tsx.
 */
import type { SessionId } from "@polaris/protocol";
import { slots } from "../app/slots.tsx";
import { useSelection, useShellActions } from "./hooks.ts";

export const Columns = () => {
  const { hostKey, workspaceId, sessionId, pane } = useSelection();
  const { selectSession, closeNewSession } = useShellActions();

  if (hostKey === null || workspaceId === null) {
    return (
      <section className="text-body text-text-faint grid min-w-0 flex-1 place-items-center">
        No workspaces yet
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
        <slots.NoSession hostKey={hostKey} workspaceId={workspaceId} />
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
        <slots.SessionOutput hostKey={hostKey} sessionId={sessionId} />
      </section>
    </>
  );
};
