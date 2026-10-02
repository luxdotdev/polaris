/**
 * The selection actions (DESIGN.md, Editor; Paper E2a): "Edit or ask ⌘I" and "Add to agent
 * session ⌘L" in a small raised bar beside the selection's first line, never over the
 * selected text. Pressing it keeps the editor focused, so the selection stays.
 */
import { ChatIcon, Kbd } from "@polaris/ui";
import type { BarPlace } from "../cm/index.ts";

export interface SelectionBarProps {
  readonly place: BarPlace;
  readonly onAsk: () => void;
  readonly onAdd: () => void;
}

const ACTION =
  "flex h-[26px] cursor-default items-center gap-gap rounded-[7px] pr-1.5 pl-gap text-body font-medium";

export const SelectionBar = ({ place, onAsk, onAdd }: SelectionBarProps) => (
  <div
    role="toolbar"
    aria-label="Selection"
    data-testid="selection-bar"
    style={{ transform: `translate(${place.left}px, ${place.top}px)` }}
    className="rounded-row border-hairline bg-surface-raised shadow-float absolute top-0 left-0 flex w-max items-center gap-0.5 border p-[3px] font-sans"
    // Keeps focus (and the selection) in the editor.
    onMouseDown={(event) => event.preventDefault()}
  >
    <button
      type="button"
      onClick={onAsk}
      data-testid="selection-ask"
      className={`${ACTION} bg-fill-selected text-text-strong`}
    >
      <ChatIcon size={14} />
      Edit or ask
      <Kbd>⌘I</Kbd>
    </button>
    <button
      type="button"
      onClick={onAdd}
      data-testid="selection-add"
      className={`${ACTION} text-text-subtle hover:bg-fill-hover hover:text-text-default`}
    >
      Add to agent session
      <Kbd>⌘L</Kbd>
    </button>
  </div>
);
