/**
 * Selecting text in an agent's message offers "Comment" over the selection (DESIGN.md, Shared
 * Sessions); it opens the owner's draft under that message. Only in a shared session.
 */
import { Button } from "@polaris/ui";
import { Predicate } from "effect";
import { type RefObject, useEffect, useState } from "react";
import type { TurnView } from "../../../../store/sessionModel.ts";
import { openCommentDraft } from "../../data/session.ts";
import { quoteRange } from "../../model/session.ts";
import { useSessionComments } from "./hooks.ts";

/** The attribute a finished message's body carries: its item id, and its Turn's. */
export const MESSAGE_ATTR = "data-comment-message";

export const TURN_ATTR = "data-comment-turn";

interface Offer {
  readonly top: number;
  readonly left: number;
  readonly turnId: string;
  readonly messageId: string;
  readonly quote: string;
}

const messageOf = (node: Node | null): HTMLElement | null =>
  (node instanceof HTMLElement ? node : (node?.parentElement ?? null))?.closest<HTMLElement>(
    `[${MESSAGE_ATTR}]`
  ) ?? null;

/** The selection, when it lies inside one message of `host`. */
const offerIn = (host: HTMLElement): Offer | null => {
  const selection = window.getSelection();

  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;
  const message = messageOf(selection.anchorNode);
  const quote = selection.toString().trim();

  if (message === null || message !== messageOf(selection.focusNode) || quote === "") return null;

  if (!host.contains(message)) return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  const box = host.getBoundingClientRect();

  return {
    top: rect.top - box.top - 34,
    left: Math.max(8, Math.min(rect.right - box.left - 40, box.width - 96)),
    turnId: message.getAttribute(TURN_ATTR) ?? "",
    messageId: message.getAttribute(MESSAGE_ATTR) ?? "",
    quote,
  };
};

const messageText = (turns: ReadonlyArray<TurnView>, turnId: string, messageId: string) => {
  const item = turns.find((v) => v.turn.id === turnId)?.items.find((i) => i.id === messageId);

  return item !== undefined && Predicate.isTagged(item, "AssistantMessage") ? item.text : "";
};

export const SelectionComment = ({
  host,
  hostKey,
  sessionId,
  turns,
}: {
  host: RefObject<HTMLElement | null>;
  hostKey: string;
  sessionId: string;
  turns: ReadonlyArray<TurnView>;
}) => {
  const { shared } = useSessionComments(hostKey, sessionId);
  const [offer, setOffer] = useState<Offer | null>(null);

  useEffect(() => {
    const element = host.current;

    if (!shared || element === null) return;
    const update = () => setOffer(offerIn(element));

    const clear = () => {
      if (window.getSelection()?.isCollapsed ?? true) setOffer(null);
    };

    element.addEventListener("mouseup", update);
    element.addEventListener("keyup", update);
    document.addEventListener("selectionchange", clear);

    return () => {
      element.removeEventListener("mouseup", update);
      element.removeEventListener("keyup", update);
      document.removeEventListener("selectionchange", clear);
    };
  }, [host, shared]);

  if (offer === null) return null;

  const comment = () => {
    const text = messageText(turns, offer.turnId, offer.messageId);
    const range = quoteRange(text, offer.quote) ?? { start: 0, end: text.length };

    openCommentDraft(hostKey, sessionId, {
      kind: "message",
      turnId: offer.turnId,
      messageId: offer.messageId,
      ...range,
      quote: offer.quote,
    });
    window.getSelection()?.removeAllRanges();
    setOffer(null);
  };

  return (
    <div className="absolute z-20" style={{ top: offer.top, left: offer.left }}>
      <Button
        size="sm"
        variant="secondary"
        // Keep the selection: a mousedown here would collapse it before the click.
        onMouseDown={(e) => e.preventDefault()}
        onClick={comment}
        data-testid="selection-comment"
      >
        Comment
      </Button>
    </div>
  );
};
