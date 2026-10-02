/**
 * "Agents in {workspace}" under the tree (DESIGN.md, Editor → Explorer): the
 * Workspace's sessions as session rows, needs-you first; a row opens it.
 */
import type { WorkspaceId } from "@polaris/protocol";
import { Row } from "@polaris/ui";
import { useMemo, useState } from "react";
import { activeSessions, needsYou, shownState } from "../../../../routes/topBar.ts";
import { sessionOrder } from "../../../../routes/selection.ts";
import { activityOf, age, sessionLine, sessionStateLabel } from "../../../../shell/copy.ts";
import { SessionTile } from "../../../../shell/glyphs.tsx";
import { useApp, useShellActions } from "../../../../shell/hooks.ts";
import { useNow } from "../../../../shell/useNow.ts";
import type { SessionEntry } from "../../../../store/hostModel.ts";
import { sessionKey } from "../../../../store/store.ts";

/** Rows shown before "N more" (the sidebar's machine groups show three too). */
const SHOWN = 3;

const AgentRow = ({
  hostKey,
  entry,
  now,
}: {
  readonly hostKey: string;
  readonly entry: SessionEntry;
  readonly now: number;
}) => {
  const { selectSession } = useShellActions();
  const density = useApp((s) => s.density);
  const { session } = entry;
  const state = shownState(entry);

  const activity = useApp((s) =>
    session.state === "working" ? activityOf(s.sessions[sessionKey(hostKey, session.id)]) : null
  );

  return (
    <Row
      role="button"
      tabIndex={0}
      data-testid="explorer-agent"
      data-state={state}
      onClick={() => selectSession({ hostKey, sessionId: session.id })}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        selectSession({ hostKey, sessionId: session.id });
      }}
      variant="session"
      tone={needsYou(entry) ? "needs-you" : session.state === "dormant" ? "quiet" : "default"}
      leading={<SessionTile state={state} harness={session.harness} density={density} />}
      title={session.title || "Untitled session"}
      description={sessionLine(entry, activity)}
      meta={<span aria-label={sessionStateLabel[state]}>{age(session.createdAt, now)}</span>}
    />
  );
};

export interface AgentsInProps {
  readonly hostKey: string;
  readonly workspaceId: WorkspaceId;
  readonly name: string;
}

export const AgentsIn = ({ hostKey, workspaceId, name }: AgentsInProps) => {
  const model = useApp((s) => s.hostModels[hostKey]);
  const now = useNow();
  const [all, setAll] = useState(false);

  const sessions = useMemo(
    () => (model === undefined ? [] : [...activeSessions(model, workspaceId)].sort(sessionOrder)),
    [model, workspaceId]
  );

  if (sessions.length === 0) return null;
  const shown = all ? sessions : sessions.slice(0, SHOWN);

  return (
    <section className="flex shrink-0 flex-col gap-0.5 px-2 pt-2" aria-label={`Agents in ${name}`}>
      <h2 className="text-caption text-text-subtle px-2 pt-2 pb-1.5 font-normal">
        Agents in {name}
      </h2>
      <div className="flex max-h-[40vh] flex-col gap-0.5 overflow-y-auto">
        {shown.map((entry) => (
          <AgentRow key={entry.session.id} hostKey={hostKey} entry={entry} now={now} />
        ))}
      </div>
      {sessions.length > SHOWN ? (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="text-caption text-text-subtle hover:text-text-default cursor-default self-start px-2 py-1"
        >
          {all ? "Show fewer" : `${sessions.length - SHOWN} more`}
        </button>
      ) : null}
    </section>
  );
};
