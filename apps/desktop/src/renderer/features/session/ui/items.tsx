/**
 * One Turn item in the conversation (DESIGN.md, Turns in the conversation):
 * prose, a folded "Thought" disclosure, commands with their output tail, file
 * changes by git letter, tool calls, the step checklist and errors.
 */
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  cn,
  Dither,
  GitStatusLetter,
  type Harness,
  PixelFailedIcon,
} from "@polaris/ui";
import { type ReactNode, useState } from "react";
import { type FileChangeKind, type ItemView, outputTail, type PlanStep } from "../model/items.ts";
import { softWrap } from "./softWrap.tsx";

type Hue = Harness | null;

const TAIL_LINES = 8;

const WELL = "rounded-row border-hairline bg-surface-raised/50 border";

const Disclosure = ({
  open,
  onToggle,
  children,
  trailing,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
  readonly trailing?: ReactNode;
}) => (
  <button
    type="button"
    aria-expanded={open}
    onClick={onToggle}
    className="text-body text-text-subtle hover:text-text-default flex h-6 cursor-default items-center gap-2 self-start"
  >
    {children}
    {open ? (
      <ChevronDownIcon size={10} className="text-text-faint" />
    ) : (
      <ChevronRightIcon size={10} className="text-text-faint" />
    )}
    {trailing}
  </button>
);

const LiveMark = ({ hue }: { readonly hue: Hue }) =>
  hue === null ? null : <Dither hue={hue} size={12} moving />;

const Message = ({ text, live }: { readonly text: string; readonly live: boolean }) => (
  <p
    data-testid={live ? "live-item" : "message"}
    className="text-body text-text-default leading-[19px] break-words whitespace-pre-wrap"
  >
    {softWrap(text)}
  </p>
);

const Reasoning = ({ text, live, hue }: { text: string; live: boolean; hue: Hue }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <Disclosure open={open} onToggle={() => setOpen(!open)}>
        {live ? <LiveMark hue={hue} /> : null}
        {live ? "Thinking" : "Thought"}
      </Disclosure>
      {open ? (
        <p className="text-body text-text-subtle break-words whitespace-pre-wrap">
          {softWrap(text)}
        </p>
      ) : null}
    </div>
  );
};

const exitLabel = (item: Extract<ItemView, { kind: "command" }>): string => {
  if (item.status === "declined") return "declined";

  if (item.live || item.status === "running") return "running";

  return item.exitCode === null ? item.status : `exit ${item.exitCode}`;
};

const Command = ({ item, hue }: { item: Extract<ItemView, { kind: "command" }>; hue: Hue }) => {
  const [all, setAll] = useState(false);
  const tail = outputTail(item.output, TAIL_LINES);
  const failed = item.status === "failed" || (item.exitCode !== null && item.exitCode !== 0);

  return (
    <div className={cn(WELL, "flex flex-col overflow-clip")} data-testid="command">
      <div className="h-row gap-row-x flex items-center px-3">
        {item.live ? (
          <LiveMark hue={hue} />
        ) : failed ? (
          <PixelFailedIcon size={14} className="text-failed" />
        ) : (
          <CheckIcon size={14} className="text-text-subtle" />
        )}
        <span className="text-code-inline text-text-default flex-1 truncate font-mono">
          {item.command === "" ? "Running a command" : `$ ${item.command}`}
        </span>
        <span className="text-caption text-text-faint tabular">{exitLabel(item)}</span>
      </div>
      {item.output === "" ? null : (
        <div className="border-hairline border-t">
          {tail.hidden > 0 ? (
            <button
              type="button"
              onClick={() => setAll(!all)}
              className="text-caption text-text-subtle hover:text-text-default w-full cursor-default px-3 pt-1.5 text-left"
            >
              {all ? "Show the last lines" : `Show ${tail.hidden} earlier lines`}
            </button>
          ) : null}
          <pre className="text-code-inline text-text-subtle max-h-[480px] overflow-auto px-3 py-2 font-mono leading-[18px] break-all whitespace-pre-wrap">
            {all ? item.output : tail.text}
          </pre>
        </div>
      )}
    </div>
  );
};

const GIT_STATUS = {
  add: "added",
  modify: "modified",
  delete: "deleted",
} as const satisfies Record<FileChangeKind, string>;

const Files = ({
  item,
  onOpenDiff,
}: {
  readonly item: Extract<ItemView, { kind: "files" }>;
  readonly onOpenDiff: () => void;
}) => (
  <div className={cn(WELL, "flex flex-col py-1.5")} data-testid="file-change">
    {item.changes.map((change) => (
      <button
        key={change.path}
        type="button"
        onClick={onOpenDiff}
        className="hover:bg-fill-hover h-row gap-row-x flex cursor-default items-center px-3 text-left"
      >
        <GitStatusLetter status={GIT_STATUS[change.kind]} />
        <span
          className={cn(
            "text-code-inline text-text-default flex-1 truncate font-mono",
            change.kind === "delete" && "line-through"
          )}
        >
          {change.path}
        </span>
        {item.status === "running" ? (
          <span className="text-caption text-text-faint">writing</span>
        ) : null}
      </button>
    ))}
  </div>
);

const Tool = ({ item, hue }: { item: Extract<ItemView, { kind: "tool" }>; hue: Hue }) => (
  <div className="flex h-6 min-w-0 items-center gap-2" data-testid="tool-call">
    {item.status === "running" ? (
      <LiveMark hue={hue} />
    ) : (
      <CheckIcon size={12} className="text-text-faint" />
    )}
    <span className="text-caption text-text-subtle shrink-0 font-medium">{item.name}</span>
    <span className="text-code-inline text-text-faint truncate font-mono">{item.summary}</span>
  </div>
);

const CURRENT_FILL: Record<Harness, string> = {
  claude: "bg-harness-claude-code/6",
  codex: "bg-harness-codex/6",
};

const Step = ({ step, hue }: { readonly step: PlanStep; readonly hue: Hue }) => {
  const current = step.status === "in-progress";

  return (
    <div
      className={cn(
        "flex h-row shrink-0 items-center gap-row-x px-3",
        current && hue !== null && CURRENT_FILL[hue]
      )}
    >
      {step.status === "completed" ? <CheckIcon size={14} className="text-text-subtle" /> : null}
      {current && hue !== null ? <Dither hue={hue} size={14} moving /> : null}
      {step.status === "pending" || (current && hue === null) ? (
        <span className="flex w-3.5 justify-center">
          <span className="border-text-faint size-2 rounded-full border" />
        </span>
      ) : null}
      <span
        className={cn(
          "text-body flex-1 truncate",
          step.status === "completed" && "text-text-subtle",
          current && "text-text-strong font-medium",
          step.status === "pending" && "text-text-faint"
        )}
      >
        {step.text}
      </span>
    </div>
  );
};

const Plan = ({ steps, hue }: { readonly steps: ReadonlyArray<PlanStep>; readonly hue: Hue }) => (
  <div className={cn(WELL, "flex flex-col py-1.5")} data-testid="plan">
    {steps.map((step, n) => (
      <Step key={`${n}:${step.text}`} step={step} hue={hue} />
    ))}
  </div>
);

const ErrorItem = ({ message }: { readonly message: string }) => (
  <div className="flex items-start gap-2" data-testid="item-error">
    <PixelFailedIcon size={14} className="text-failed mt-0.5 shrink-0" />
    <p className="text-body text-text-default min-w-0 wrap-anywhere whitespace-pre-wrap">
      {softWrap(message)}
    </p>
  </div>
);

export interface ItemProps {
  readonly item: ItemView;
  readonly hue: Hue;
  readonly onOpenDiff: () => void;
}

/** One item, by kind. */
export const Item = ({ item, hue, onOpenDiff }: ItemProps) => {
  switch (item.kind) {
    case "message":
      return <Message text={item.text} live={item.live} />;
    case "reasoning":
      return <Reasoning text={item.text} live={item.live} hue={hue} />;
    case "command":
      return <Command item={item} hue={hue} />;
    case "files":
      return <Files item={item} onOpenDiff={onOpenDiff} />;
    case "tool":
      return <Tool item={item} hue={hue} />;
    case "plan":
      return <Plan steps={item.steps} hue={hue} />;
    case "error":
      return <ErrorItem message={item.message} />;
  }
};
