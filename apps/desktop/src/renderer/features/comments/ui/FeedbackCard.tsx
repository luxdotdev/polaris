/**
 * "Feedback for turn N" in an Agent Session's risk column (Paper R8 91B-0): the draft batch
 * quoting each comment's lines, an optional message, and "Send to session", which sends the
 * whole batch as one Turn (ENG-223).
 */
import { cn, type CssVars, harnessHue, harnessTextVar, hueVar, Textarea, Tile } from "@polaris/ui";
import { useState } from "react";
import { revealInDiff } from "../../review/index.ts";
import { sendFeedback, setFeedbackMessage } from "../data/actions.ts";
import { useComments } from "../data/store.ts";
import { useSessionHarness } from "./hooks.ts";
import { batchCaption, draftPlace, emptyBatch } from "../model/feedback.ts";

/**
 * "Send to @claude" (DESIGN.md, Feedback for the next turn): the Harness picker chip's form,
 * its tile and handle in the Harness hue, sending the batch as the session's next Turn.
 */
const SendChip = ({
  harness,
  disabled,
  onSend,
}: {
  readonly harness: string | null;
  readonly disabled: boolean;
  readonly onSend: () => void;
}) => {
  const vars: CssVars = {
    "--chip-hue": harness === null ? "var(--color-hairline)" : hueVar(harness),
    "--chip-text": harness === null ? "var(--color-text-default)" : harnessTextVar(harness),
  };

  return (
    <button
      type="button"
      data-testid="feedback-send"
      disabled={disabled}
      onClick={onSend}
      className={cn(
        "rounded-control bg-surface-raised text-caption flex h-6 cursor-default items-center gap-1.5 border pr-2 pl-1 font-medium",
        "border-[color-mix(in_oklab,var(--chip-hue)_28%,transparent)] text-(--chip-text)",
        "hover:bg-fill-hover disabled:opacity-(--opacity-dimmed)"
      )}
      style={vars}
    >
      {harness !== null && <Tile hue={harness} size={20} style={{ width: 16, height: 16 }} />}
      Send to {harness === null ? "session" : harnessHue(harness).handle}
    </button>
  );
};

export const FeedbackCard = ({ subjectKey }: { readonly subjectKey: string }) => {
  const batch = useComments((s) => s.batches[subjectKey] ?? emptyBatch);
  const drafting = useComments((s) => s.composers[subjectKey] !== undefined);
  const nextTurn = useComments((s) => s.sessions[subjectKey]?.nextTurn ?? null);
  const harness = useSessionHarness(subjectKey);

  const [state, setState] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });

  if (batch.comments.length === 0 && batch.message === "" && !drafting) return null;

  const send = async () => {
    setState({ busy: true, error: null });
    const done = await sendFeedback(subjectKey);

    setState({ busy: false, error: done.ok ? null : done.message });
  };

  const empty = batch.comments.length === 0 && batch.message.trim() === "";

  return (
    <section
      data-testid="feedback-card"
      className="bg-surface-sunken rounded-row gap-row-x mx-gap mt-3 flex flex-col p-3"
    >
      <div className="gap-gap flex items-center">
        <span className="text-body text-text-strong flex-1 font-medium">
          Feedback for turn {nextTurn ?? "…"}
        </span>
        <span className="text-caption text-text-subtle">{batchCaption(batch, drafting)}</span>
      </div>
      {batch.comments.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => revealInDiff(c.path, c.lines.end, c.lines.side)}
          className="border-hairline pl-row-x hover:bg-fill-hover flex cursor-default flex-col gap-1 border-l-2 text-left"
        >
          <span className="text-text-subtle font-mono text-[11px] leading-4">{draftPlace(c)}</span>
          <span className="text-caption text-text-default line-clamp-3">{c.note}</span>
        </button>
      ))}
      <Textarea
        bare
        rows={1}
        aria-label="Message for the turn"
        placeholder="Add a message (optional)"
        className="text-caption max-h-32"
        value={batch.message}
        onChange={(event) => setFeedbackMessage(subjectKey, event.target.value)}
      />
      {state.error !== null && <p className="text-caption text-failed-text">{state.error}</p>}
      <div className="flex items-center gap-1.5">
        <SendChip harness={harness} disabled={empty || state.busy} onSend={() => void send()} />
        <span className="text-caption text-text-subtle">quotes the lines</span>
      </div>
    </section>
  );
};
