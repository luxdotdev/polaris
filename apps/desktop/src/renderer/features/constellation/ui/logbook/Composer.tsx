/**
 * The note composer pinned under a Task's Logbook (n). A note is record only; "Send to worker
 * as a message" takes the operator message path for when the worker should hear it.
 */
import { Button, Kbd } from "@polaris/ui";
import { type KeyboardEvent, type RefObject, useState } from "react";
import { shortcutLabel } from "../../../../../shared/chord.ts";
import { FIELD_CHORDS } from "../../../../../shared/keymap.ts";

export interface ComposerProps {
  readonly taskId: string;
  readonly inputRef: RefObject<HTMLTextAreaElement | null>;
  /** Resolves true once the Daemon took it; the text clears then. */
  readonly onNote: (text: string) => Promise<boolean>;
  /** Null when the Task has no worker to hear it. */
  readonly onMessage: ((text: string) => Promise<boolean>) | null;
}

export const Composer = ({ taskId, inputRef, onNote, onMessage }: ComposerProps) => {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const empty = text.trim() === "";

  const send = async (how: (text: string) => Promise<boolean>) => {
    if (empty || busy) return;
    setBusy(true);
    const ok = await how(text.trim());

    setBusy(false);

    if (ok) setText("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send(onNote);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.blur();
    }
  };

  return (
    <div className="gap-gap px-panel pt-gap flex shrink-0 flex-col" data-testid="logbook-composer">
      <div className="bg-surface-sunken border-hairline rounded-row gap-row-x flex min-h-9 items-end border px-3 py-1">
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={`Note on ${taskId}`}
          placeholder={`Add a note to ${taskId}'s logbook`}
          className="text-body text-text-default placeholder:text-text-faint field-sizing-content max-h-32 min-w-40 flex-1 resize-none bg-transparent py-[5px] outline-none"
        />
        <span className="text-caption text-text-faint hidden h-7 shrink-0 items-center @min-[44rem]:flex">
          the lead and {taskId} read it
        </span>
        {onMessage === null ? null : (
          <Button
            size="xs"
            variant="ghost"
            className="mb-0.5"
            disabled={empty || busy}
            onClick={() => void send(onMessage)}
          >
            Send to worker as a message
          </Button>
        )}
        <Button
          size="xs"
          className="mb-0.5"
          disabled={empty || busy}
          onClick={() => void send(onNote)}
        >
          Note
          <Kbd variant="plain">{shortcutLabel(FIELD_CHORDS.submit)}</Kbd>
        </Button>
      </div>
    </div>
  );
};
