/**
 * Background tasks in the session view (DESIGN.md, Waiting on background tasks):
 * the footer line of an Idle session still waiting on them, the hover that lists
 * each one, and the quiet opening of a Turn the Harness started itself.
 */
import type { BackgroundTask } from "@polaris/protocol";
import {
  cn,
  type Harness,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@polaris/ui";
import { type ReactElement, useState } from "react";
import { type Waiting as WaitingOn, waitingLine } from "../model/background.ts";
import { RosterKicker, SubagentRows } from "./subagentRow.tsx";

/** Each task on its own line: its description, then its kind. */
export const BackgroundTaskList = ({
  tasks,
}: {
  readonly tasks: ReadonlyArray<BackgroundTask>;
}) => (
  <ul className="flex max-w-96 flex-col gap-1 py-1.5" data-testid="background-tasks">
    {tasks.map((task) => (
      <li key={task.id} className="flex min-w-0 items-baseline gap-3">
        <span
          className={cn(
            "text-text-default line-clamp-2 min-w-0 flex-1 wrap-anywhere",
            task.kind === "command" ? "text-code-inline font-mono" : "text-caption"
          )}
        >
          {task.description === "" ? task.id : task.description}
        </span>
        <span className="text-caption text-text-subtle shrink-0">{task.kind}</span>
      </li>
    ))}
  </ul>
);

/** Hovering `children` lists the tasks. */
export const BackgroundTasksHover = ({
  tasks,
  children,
  side = "top",
}: {
  readonly tasks: ReadonlyArray<BackgroundTask>;
  readonly children: ReactElement;
  readonly side?: "top" | "right";
}) => (
  <Tooltip>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent side={side} align="start" className="h-auto items-start">
      <BackgroundTaskList tasks={tasks} />
    </TooltipContent>
  </Tooltip>
);

const AVATAR = "flex w-6 shrink-0 justify-center";

export interface WaitingProps {
  readonly waiting: WaitingOn;
  readonly harness: Harness | null;
  readonly onOpenSubagent: (subagentId: string) => void;
}

/**
 * The conversation's last line while an Idle session waits; no dither, nothing runs. Its hover
 * lists the running Subagents as the composer's popover does (each opens its tab), then the rest.
 */
export const Waiting = ({ waiting, harness, onOpenSubagent }: WaitingProps) => {
  const [open, setOpen] = useState(false);
  const { subagents, tasks } = waiting;

  const openOne = (id: string) => {
    setOpen(false);
    onOpenSubagent(id);
  };

  return (
    <div className="flex items-center gap-3" data-testid="waiting">
      <div className={AVATAR} />
      <HoverCard open={open} onOpenChange={setOpen}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-caption text-text-subtle decoration-text-faint cursor-default underline decoration-dotted underline-offset-4"
          >
            {waitingLine(waiting)}
          </button>
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          data-surface="raised"
          className="flex w-[460px] max-w-[calc(100vw-24px)] flex-col p-1"
          data-testid="waiting-card"
        >
          {subagents.length === 0 ? null : (
            <>
              <RosterKicker parts={["Subagents", `${subagents.length} running`]} />
              <div className="max-h-72 overflow-y-auto">
                <SubagentRows rows={subagents} harness={harness} onOpen={openOne} />
              </div>
            </>
          )}
          {tasks.length === 0 ? null : (
            <div className="px-3">
              <BackgroundTaskList tasks={tasks} />
            </div>
          )}
        </HoverCardContent>
      </HoverCard>
    </div>
  );
};

/** A Turn the Harness started itself opens with what woke it, on the agent's side. */
export const Trigger = ({ text, model }: { readonly text: string; readonly model: string }) => (
  <div className="flex items-center gap-3" data-testid="turn-trigger">
    <div className={AVATAR} />
    <p className="text-caption text-text-subtle min-w-0 truncate">
      {text}
      {model === "" ? null : <span data-testid="turn-model"> · {model}</span>}
    </p>
  </div>
);
