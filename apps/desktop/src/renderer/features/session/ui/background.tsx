/**
 * Background tasks in the session view (DESIGN.md, Waiting on background tasks):
 * the footer line of an Idle session still waiting on them, the hover that lists
 * each one, and the quiet opening of a Turn the Harness started itself.
 */
import type { BackgroundTask } from "@polaris/protocol";
import { cn, Dither, Tooltip, TooltipContent, TooltipTrigger } from "@polaris/ui";
import type { ReactElement } from "react";
import { waitingPhrase } from "../model/background.ts";
import type { Hue } from "./items.tsx";

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

/** The conversation's last line while an Idle session waits: a still dither, never looping. */
export const Waiting = ({
  tasks,
  hue,
}: {
  readonly tasks: ReadonlyArray<BackgroundTask>;
  readonly hue: Hue;
}) => (
  <div className="flex items-center gap-3" data-testid="waiting">
    <div className={AVATAR}>{hue === null ? null : <Dither hue={hue} size={12} />}</div>
    <BackgroundTasksHover tasks={tasks}>
      <p
        tabIndex={0}
        className="text-caption text-text-subtle decoration-text-faint cursor-default underline decoration-dotted underline-offset-4"
      >
        {waitingPhrase(tasks)}
      </p>
    </BackgroundTasksHover>
  </div>
);

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
