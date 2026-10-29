/**
 * Output's Subagent tab, next to Changes: one Subagent's moon, agent type, task and status,
 * then its transcript streaming live through the inline card's renderers, its report last.
 * Read-only for now: no composer. Closing it, or Escape inside it, returns to Changes.
 */
import type { SessionId } from "@polaris/protocol";
import { Button, cn, CloseIcon, type Harness, IconButton } from "@polaris/ui";
import { type KeyboardEvent, type ReactNode, type UIEvent, useLayoutEffect, useRef } from "react";
import { useSession } from "../hooks.ts";
import { findSubagent, type SubagentCard } from "../model/subagents.ts";
import { showSubagent, uiKey, useSessionUi } from "../state.ts";
import { SubagentReport, SubagentTranscript } from "./entries.tsx";
import { type SessionTarget, SessionTargetContext } from "./polarisTool/target.ts";
import { SubagentElapsed, SubagentMoon } from "./subagentRow.tsx";

/** One of Output's tabs: Changes, a Lead's Constellation. */
export const OutputTab = ({
  id,
  on,
  onClick,
  children,
}: {
  readonly id: string;
  readonly on: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) => (
  <Button
    variant={on ? "secondary" : "ghost"}
    className={cn(on && "text-text-strong")}
    aria-pressed={on}
    onClick={onClick}
    data-testid={`output-tab-${id}`}
  >
    {children}
  </Button>
);

export interface ShownSubagent {
  readonly card: SubagentCard;
  readonly index: number;
}

/** The Subagent Output shows for this session; null when none is chosen or it has gone. */
export const useShownSubagent = (hostKey: string, sessionId: SessionId): ShownSubagent | null => {
  const model = useSession(hostKey, sessionId);
  const { subagentId } = useSessionUi(uiKey(hostKey, sessionId));

  return findSubagent(model.turns, subagentId);
};

export const closeSubagent = (hostKey: string, sessionId: string) =>
  showSubagent(uiKey(hostKey, sessionId), null);

const STATUS = {
  working: "working",
  completed: "done",
  failed: "failed",
  interrupted: "stopped",
} as const;

/** The Subagent's tab: its moon and agent type, and a close button back to Changes. */
export const SubagentTab = ({
  shown,
  harness,
  onClose,
}: {
  readonly shown: ShownSubagent;
  readonly harness: Harness | null;
  readonly onClose: () => void;
}) => {
  const { subagent } = shown.card;

  return (
    <span className="flex items-center" data-testid="output-tab-subagent">
      <Button variant="secondary" className="text-text-strong gap-2" aria-pressed>
        <SubagentMoon
          index={shown.index}
          working={subagent.status === "working"}
          harness={harness}
        />
        <span className="max-w-40 truncate">{subagent.agent ?? "Subagent"}</span>
      </Button>
      <IconButton
        size="sm"
        label="Close subagent"
        icon={<CloseIcon size={12} />}
        onClick={onClose}
        data-testid="subagent-close"
      />
    </span>
  );
};

/** Whether the pane is scrolled to (near) its end, where it keeps following new items. */
const atEnd = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 24;

export interface SubagentPaneProps {
  readonly shown: ShownSubagent;
  readonly harness: Harness | null;
  readonly target: SessionTarget;
  readonly onClose: () => void;
  /** An item's "Open diff": Changes on the Subagent's Turn. */
  readonly onOpenDiff: () => void;
}

export const SubagentPane = ({
  shown,
  harness,
  target,
  onClose,
  onOpenDiff,
}: SubagentPaneProps) => {
  const { card } = shown;
  const { subagent } = card;
  const working = subagent.status === "working";
  const scrollRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  useLayoutEffect(() => {
    follow.current = true;
  }, [card.id]);

  // While it works, each render may add items or text: keep the end in view unless scrolled up.
  useLayoutEffect(() => {
    const el = scrollRef.current;

    if (el !== null && follow.current) el.scrollTop = el.scrollHeight;
  });

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    follow.current = atEnd(event.currentTarget);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={onKeyDown}
      data-testid="subagent-pane"
      data-status={subagent.status}
    >
      <header className="border-hairline gap-row-x flex shrink-0 items-center border-b px-4 py-3">
        <SubagentMoon index={shown.index} working={working} harness={harness} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-caption text-text-subtle truncate">
            {subagent.agent ?? "Subagent"}
          </span>
          <span className="text-label text-text-strong truncate">{subagent.title}</span>
        </div>
        <span className="text-caption text-text-subtle shrink-0" data-testid="subagent-status">
          {working ? (card.activity ?? STATUS.working) : STATUS[subagent.status]}
        </span>
        <SubagentElapsed
          startedAt={subagent.startedAt}
          endedAt={subagent.endedAt}
          working={working}
        />
      </header>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        tabIndex={0}
        aria-label={`${subagent.agent ?? "Subagent"} transcript`}
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-4 py-3 select-text"
        data-testid="subagent-pane-transcript"
      >
        <SessionTargetContext.Provider value={target}>
          <SubagentTranscript card={card} ctx={{ hue: harness, onOpenDiff }} taskClamp={false} />
        </SessionTargetContext.Provider>
        <SubagentReport card={card} className="border-hairline mt-1.5 border-t pt-3" />
      </div>
    </div>
  );
};
