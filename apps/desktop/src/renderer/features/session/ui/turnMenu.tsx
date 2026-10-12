/**
 * An agent row's right-click menu: Copy (the selection, when there is one), Copy message, and
 * Copy turn output, every reply of a finished Turn as Markdown. Each answers in a short toast.
 */
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  COPY_FAILED,
  type CopyWrite,
  PixelCheckIcon,
  PixelFailedIcon,
  showToast,
  useCopyWrite,
} from "@polaris/ui";
import { Predicate } from "effect";
import { createElement, type ReactElement, useState } from "react";
import { useApp } from "../../../shell/hooks.ts";
import type { TurnView } from "../../../store/sessionModel.ts";
import { sessionKey } from "../../../store/store.ts";
import { completedItemView, turnOutput } from "../model/items.ts";

const copyText = (write: CopyWrite, text: string, what: string) =>
  void write(text)
    .catch(() => false)
    .then((ok) =>
      showToast({
        source: "starlight",
        icon: createElement(ok ? PixelCheckIcon : PixelFailedIcon, { size: 16 }),
        title: ok ? `Copied ${what}` : COPY_FAILED,
        duration: 1500,
      })
    );

const replies = (view: TurnView) =>
  view.items.filter((item) => Predicate.isTagged(item, "AssistantMessage")).length;

/** The text selected now, when the selection sits inside `root`. */
const selectionIn = (root: Element): string => {
  const selection = window.getSelection();

  if (selection === null || selection.isCollapsed) return "";
  const { anchorNode } = selection;

  return anchorNode !== null && root.contains(anchorNode) ? selection.toString() : "";
};

export interface TurnMenuProps {
  readonly hostKey: string;
  readonly sessionId: string;
  readonly turnId: string;
  /** The row's own Markdown, when the row is a finished reply. */
  readonly message: string | null;
  readonly live: boolean;
  readonly children: ReactElement;
}

export const TurnMenu = ({
  hostKey,
  sessionId,
  turnId,
  message,
  live,
  children,
}: TurnMenuProps) => {
  const write = useCopyWrite();
  const [selected, setSelected] = useState("");

  const view = useApp((s) =>
    s.sessions[sessionKey(hostKey, sessionId)]?.turns.find((t) => t.turn.id === turnId)
  );

  // One reply's output is its message: the menu offers it once.
  const output =
    live || view === undefined || replies(view) === 0 || (message !== null && replies(view) < 2)
      ? null
      : view;

  if (message === null && output === null) return children;

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open) setSelected("");
      }}
    >
      <ContextMenuTrigger
        asChild
        onContextMenu={(event) => setSelected(selectionIn(event.currentTarget))}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-44" data-testid="turn-menu">
        {selected === "" ? null : (
          <ContextMenuItem onSelect={() => copyText(write, selected, "selection")}>
            Copy
          </ContextMenuItem>
        )}
        {message === null ? null : (
          <ContextMenuItem onSelect={() => copyText(write, message, "message")}>
            Copy message
          </ContextMenuItem>
        )}
        {output === null ? null : (
          <ContextMenuItem
            onSelect={() =>
              copyText(write, turnOutput(output.items.map(completedItemView)), "turn output")
            }
          >
            Copy turn output
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
};
