/**
 * A shared session's queue in the composer (Paper SS1; DESIGN.md, Shared Sessions): each queued
 * Turn with its author and prompt, Edit and Cancel for its author or the owner, and a paused
 * queue's "Queue paused · N Turns" with Resume. Nothing queued, nothing shown.
 */
import { Button, Input } from "@polaris/ui";
import { useState } from "react";
import { type ActorViewer, ActorAvatar, turnAuthorLabel } from "../../comments/index.ts";
import {
  mayChange,
  pausedLine,
  type QueueView,
  type QueueViewer,
  type SessionQueuedTurn,
} from "../model/queue.ts";

export interface QueuedTurnsProps {
  readonly queue: QueueView;
  readonly viewer: QueueViewer;
  /** Who is reading, for the authors' names. */
  readonly names: ActorViewer;
  readonly onCancel: (turnId: SessionQueuedTurn["id"]) => void;
  readonly onEdit: (turnId: SessionQueuedTurn["id"], prompt: string) => void;
  /** Starts the head of a paused queue; null when the viewer may not send Turns. */
  readonly onResume: (() => void) | null;
}

const ROW = "pr-gap flex h-[38px] shrink-0 items-center gap-2 pl-[18px]";

const KICKER =
  "text-text-subtle w-[54px] shrink-0 font-mono text-[11px] font-medium tracking-[0.08em]";

const Editing = ({
  queued,
  onSave,
  onDone,
}: {
  readonly queued: SessionQueuedTurn;
  readonly onSave: (prompt: string) => void;
  readonly onDone: () => void;
}) => {
  const [text, setText] = useState(queued.prompt);

  const save = () => {
    if (text.trim() !== "" && text !== queued.prompt) onSave(text);
    onDone();
  };

  return (
    <>
      <Input
        autoFocus
        aria-label="Queued turn"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") save();

          if (event.key === "Escape") onDone();
        }}
        className="h-7 min-w-0 flex-1"
      />
      <Button variant="ghost" size="sm" className="rounded-full" onClick={onDone}>
        Cancel
      </Button>
      <Button variant="secondary" size="sm" className="rounded-full" onClick={save}>
        Save
      </Button>
    </>
  );
};

const QueuedRow = ({
  queued,
  first,
  props,
}: {
  readonly queued: SessionQueuedTurn;
  readonly first: boolean;
  readonly props: QueuedTurnsProps;
}) => {
  const [editing, setEditing] = useState(false);
  const changes = mayChange(queued, props.viewer);

  return (
    <li className={ROW} data-testid="queued-turn">
      <span className={KICKER} aria-hidden={!first}>
        {first ? "QUEUED" : ""}
      </span>
      <ActorAvatar actor={queued.actor} size={16} viewer={props.names} />
      <span
        className="text-body text-text-strong shrink-0 font-medium"
        data-testid="queued-turn-author"
      >
        {turnAuthorLabel(queued.actor, props.names)}
      </span>
      {editing ? (
        <Editing
          queued={queued}
          onSave={(prompt) => props.onEdit(queued.id, prompt)}
          onDone={() => setEditing(false)}
        />
      ) : (
        <>
          <span
            title={queued.prompt}
            className="text-body text-text-subtle min-w-0 flex-1 truncate"
          >
            {queued.prompt}
          </span>
          {changes ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                data-testid="queued-turn-cancel"
                onClick={() => props.onCancel(queued.id)}
              >
                Cancel
              </Button>
            </>
          ) : null}
        </>
      )}
    </li>
  );
};

export const QueuedTurns = (props: QueuedTurnsProps) => {
  const { turns, paused } = props.queue;

  if (turns.length === 0) return null;

  return (
    <div className="border-hairline -mt-px flex flex-col border-y" data-testid="queued-turns">
      {paused ? (
        <div className={ROW} data-testid="queue-paused">
          <span className="text-body text-text-strong shrink-0 font-medium">
            {pausedLine(turns.length)}
          </span>
          <span className="text-caption text-text-subtle min-w-0 flex-1 truncate">
            · the last turn was stopped
          </span>
          {props.onResume === null ? null : (
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full"
              data-testid="queue-resume"
              onClick={props.onResume}
            >
              Resume
            </Button>
          )}
        </div>
      ) : null}
      <ol className="flex flex-col">
        {turns.map((queued, i) => (
          <QueuedRow key={queued.id} queued={queued} first={i === 0} props={props} />
        ))}
      </ol>
    </div>
  );
};
