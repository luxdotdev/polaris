/**
 * One Turn item in the conversation (DESIGN.md, Turns in the conversation):
 * prose, a folded "Thought" disclosure, commands with their output tail, file
 * changes by git letter, tool calls, the step checklist and errors.
 */
import { CheckIcon, cn, Dither, GitStatusLetter, type Harness, PixelFailedIcon } from "@polaris/ui";
import { useState } from "react";
import { type FileChangeKind, type ItemView, outputTail } from "../model/items.ts";
import { Plan } from "./plan.tsx";
import { Reasoning } from "./reasoning.tsx";
import { softWrap } from "./softWrap.tsx";

export type Hue = Harness | null;

const TAIL_LINES = 8;

export const WELL = "rounded-row border-hairline bg-surface-raised/50 border";

export const LiveMark = ({ hue }: { readonly hue: Hue }) =>
  hue === null ? null : <Dither hue={hue} size={12} moving />;

const Message = ({ text, live }: { readonly text: string; readonly live: boolean }) => (
  <p
    data-testid={live ? "live-item" : "message"}
    className="text-body text-text-default leading-[19px] break-words whitespace-pre-wrap"
  >
    {softWrap(text)}
  </p>
);

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
        <span className="text-caption text-text-subtle tabular">{exitLabel(item)}</span>
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
          <span className="text-caption text-text-subtle">writing</span>
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
    <span className="text-code-inline text-text-subtle truncate font-mono">{item.summary}</span>
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
      return <Reasoning item={item} hue={hue} />;
    case "command":
      return <Command item={item} hue={hue} />;
    case "files":
      return <Files item={item} onOpenDiff={onOpenDiff} />;
    case "tool":
      return <Tool item={item} hue={hue} />;
    case "plan":
      return <Plan item={item} hue={hue} />;
    case "error":
      return <ErrorItem message={item.message} />;
  }
};
