/**
 * One Turn item in the conversation (DESIGN.md, Turns in the conversation):
 * prose, a folded "Thought" disclosure, commands with their output tail, file
 * changes by git letter, tool calls, the step checklist and errors.
 */
import { CheckIcon, cn, Dither, GitStatusLetter, type Harness, PixelFailedIcon } from "@polaris/ui";
import { FileLink, OpenInEditorButton } from "../../editor-links/index.ts";
import { type FileChangeKind, type ItemView } from "../model/items.ts";
import { toolVerb } from "../model/runs.ts";
import { Command } from "./command.tsx";
import { Markdown } from "./markdown/index.tsx";
import { Plan } from "./plan.tsx";
import { Reasoning } from "./reasoning.tsx";
import { softWrap } from "./softWrap.tsx";

export type Hue = Harness | null;

export const WELL = "rounded-row border-hairline bg-surface-raised/50 border";

export const LiveMark = ({ hue }: { readonly hue: Hue }) =>
  hue === null ? null : <Dither hue={hue} size={12} moving />;

const Message = ({ text, live }: { readonly text: string; readonly live: boolean }) => (
  <div
    data-testid={live ? "live-item" : "message"}
    className="text-body text-text-default min-w-0 leading-[19px]"
  >
    <Markdown text={text} live={live} />
  </div>
);

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
      <div
        key={change.path}
        className="group/file hover:bg-fill-hover h-row flex items-center pr-1"
      >
        <button
          type="button"
          onClick={onOpenDiff}
          className="gap-row-x flex h-full min-w-0 flex-1 cursor-default items-center pl-3 text-left"
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
        {change.kind === "delete" ? null : (
          <OpenInEditorButton
            path={change.path}
            className="opacity-0 group-hover/file:opacity-100 focus-visible:opacity-100"
          />
        )}
      </div>
    ))}
  </div>
);

const ToolMark = ({ item, hue }: { item: Extract<ItemView, { kind: "tool" }>; hue: Hue }) => {
  if (item.status === "running") return <LiveMark hue={hue} />;

  return item.status === "completed" ? (
    <CheckIcon size={12} className="text-text-faint" />
  ) : (
    <PixelFailedIcon size={12} className="text-failed" />
  );
};

const Tool = ({ item, hue }: { item: Extract<ItemView, { kind: "tool" }>; hue: Hue }) => (
  <div
    className="flex h-6 min-w-0 items-center gap-2"
    data-testid="tool-call"
    data-status={item.status}
  >
    <ToolMark item={item} hue={hue} />
    <span className="text-caption text-text-subtle shrink-0 font-medium">
      {toolVerb(item.name, item.status === "running")}
    </span>
    {item.file === null ? (
      <span className="text-code-inline text-text-subtle truncate font-mono">{item.summary}</span>
    ) : (
      <FileLink
        path={item.file.path}
        line={item.file.line}
        className="text-code-inline text-text-subtle font-mono"
      >
        {item.summary}
      </FileLink>
    )}
    {item.status === "declined" ? (
      <span className="text-caption text-text-subtle shrink-0">declined</span>
    ) : null}
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
    // A landed steer is the user's own row (`rows.tsx`), not an agent item.
    case "user":
      return null;
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
