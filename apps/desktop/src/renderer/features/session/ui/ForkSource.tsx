/**
 * "Fork a turn" on the new-session page: pick a session in this Workspace,
 * then one of its finished Turns. The session's feed opens to list its Turns.
 */
import type { SessionId, TurnId, WorkspaceId } from "@polaris/protocol";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@polaris/ui";
import { useEffect } from "react";
import { emptyHostModel, sessionsOf } from "../../../store/hostModel.ts";
import type { SessionData } from "../../../store/plain.ts";
import { useApp } from "../../../views/hooks.ts";
import { useSession } from "../hooks.ts";

export interface ForkSourceValue {
  readonly session: SessionData;
  readonly turnId: TurnId;
}

export interface ForkSourceProps {
  readonly hostKey: string;
  readonly workspaceId: WorkspaceId;
  readonly sessionId: SessionId | null;
  readonly onSession: (sessionId: SessionId) => void;
  readonly onChange: (value: ForkSourceValue | null) => void;
}

const TurnSelect = ({
  hostKey,
  sessionId,
  onChange,
}: {
  readonly hostKey: string;
  readonly sessionId: SessionId;
  readonly onChange: (value: ForkSourceValue | null) => void;
}) => {
  const model = useSession(hostKey, sessionId);
  const done = model.turns.filter((t) => t.turn.status !== "working").toReversed();
  const first = done[0]?.turn.id ?? null;
  const { session } = model;

  // Default to the latest finished Turn once the feed has it.
  useEffect(() => {
    onChange(session === null || first === null ? null : { session, turnId: first });
  }, [session, first, onChange]);

  if (session === null) return <span className="text-caption text-text-faint">Loading turns…</span>;

  return (
    <Select
      defaultValue={first ?? ""}
      key={first ?? "none"}
      onValueChange={(turnId) => {
        const turn = done.find((t) => t.turn.id === turnId)?.turn;

        if (turn !== undefined) onChange({ session, turnId: turn.id });
      }}
    >
      <SelectTrigger className="w-40" aria-label="Turn">
        <SelectValue placeholder="No finished turns" />
      </SelectTrigger>
      <SelectContent>
        {done.map((t) => (
          <SelectItem key={t.turn.id} value={t.turn.id}>
            Turn {t.turn.index + 1}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export const ForkSource = ({
  hostKey,
  workspaceId,
  sessionId,
  onSession,
  onChange,
}: ForkSourceProps) => {
  const model = useApp((s) => s.hostModels[hostKey]) ?? emptyHostModel;
  const sessions = sessionsOf(model, workspaceId).filter((e) => e.session.turnCount > 0);

  if (sessions.length === 0)
    return <p className="text-caption text-text-default">No sessions here have a turn to fork</p>;

  return (
    <div className="flex w-full items-center gap-2" data-testid="fork-source">
      <Select
        value={sessionId ?? ""}
        onValueChange={(id) => {
          const entry = sessions.find((e) => e.session.id === id);

          if (entry !== undefined) onSession(entry.session.id);
        }}
      >
        <SelectTrigger className="min-w-0 flex-1" aria-label="Session to fork">
          <SelectValue placeholder="Choose a session" />
        </SelectTrigger>
        <SelectContent>
          {sessions.map((e) => (
            <SelectItem key={e.session.id} value={e.session.id}>
              {e.session.title === "" ? "Untitled session" : e.session.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {sessionId === null ? null : (
        <TurnSelect hostKey={hostKey} sessionId={sessionId} onChange={onChange} />
      )}
    </div>
  );
};
