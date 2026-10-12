/**
 * The end of a finished Turn with more than one reply: "Copy output" copies every reply as
 * Markdown (one reply copies from its own icon).
 */
import { CopyButton } from "@polaris/ui";
import { Predicate } from "effect";
import { useApp } from "../../../shell/hooks.ts";
import type { TurnView } from "../../../store/sessionModel.ts";
import { sessionKey } from "../../../store/store.ts";
import { completedItemView, turnOutput } from "../model/items.ts";

const useTurn = (hostKey: string, sessionId: string, turnId: string): TurnView | undefined =>
  useApp((s) =>
    s.sessions[sessionKey(hostKey, sessionId)]?.turns.find((t) => t.turn.id === turnId)
  );

/** The Turn's last reply, when it has two or more; null otherwise. */
const lastOfMany = (view: TurnView): string | null => {
  const replies = view.items.filter((item) => Predicate.isTagged(item, "AssistantMessage"));

  return replies.length < 2 ? null : (replies.at(-1)?.id ?? null);
};

export interface TurnEndProps {
  readonly hostKey: string;
  readonly sessionId: string;
  readonly turnId: string;
  /** The row's item, shown under it only when it is the Turn's last reply. */
  readonly itemId: string;
  readonly live: boolean;
}

export const TurnEnd = ({ hostKey, sessionId, turnId, itemId, live }: TurnEndProps) => {
  const view = useTurn(hostKey, sessionId, turnId);

  if (live || view === undefined || lastOfMany(view) !== itemId) return null;

  return (
    <div className="-ml-2 pt-1" data-testid="turn-end">
      <CopyButton
        variant="button"
        buttonVariant="ghost"
        buttonSize="sm"
        label="Copy output"
        text={() => turnOutput(view.items.map(completedItemView))}
        className="text-text-subtle"
      />
    </div>
  );
};
