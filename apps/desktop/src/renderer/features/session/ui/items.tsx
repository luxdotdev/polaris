/**
 * One Turn item in the conversation (DESIGN.md, Turns in the conversation):
 * prose, a folded "Thought" disclosure, commands with their output tail, file
 * changes by git letter, tool calls, the step checklist and errors.
 */
import {
  CheckIcon,
  cn,
  CopyButton,
  Dither,
  GitStatusLetter,
  type Harness,
  PixelFailedIcon,
} from "@polaris/ui";
// The glyph alone: the Constellation feature's index imports the session feature.
import { ConstellationMark } from "../../constellation/ui/glyphs.tsx";
import { useState } from "react";
import { FileLink, OpenInEditorButton } from "../../editor-links/index.ts";
import { type FileChangeKind, type ItemView } from "../model/items.ts";
import { toolVerb } from "../model/runs.ts";
import { Command } from "./command.tsx";
import { ImageViewer } from "./ImageViewer.tsx";
import { Markdown } from "./markdown/index.tsx";
import { Plan } from "./plan.tsx";
import { Reasoning } from "./reasoning.tsx";
import { softWrap } from "./softWrap.tsx";

export type Hue = Harness | null;

export const WELL = "rounded-row border-hairline bg-surface-raised/50 border";

export const LiveMark = ({ hue }: { readonly hue: Hue }) =>
  hue === null ? null : <Dither hue={hue} size={12} moving />;

/** Its Markdown copies from a quiet icon at its top right, shown on hover or focus. */
const Message = ({ text, live }: { readonly text: string; readonly live: boolean }) => (
  <div
    data-testid={live ? "live-item" : "message"}
    className="group/message text-body text-text-default relative min-w-0 leading-[19px]"
  >
    <Markdown text={text} live={live} />
    {live ? null : (
      <CopyButton
        variant="icon"
        label="Copy message"
        text={text}
        className="bg-bg absolute -top-1 right-0 opacity-0 group-hover/message:opacity-100 focus-visible:opacity-100 data-[copy-state=copied]:opacity-100 data-[copy-state=failed]:opacity-100"
      />
    )}
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

type ToolView = Extract<ItemView, { kind: "tool" }>;

const ToolMark = ({ item, hue }: { item: ToolView; hue: Hue }) => {
  if (item.status === "running") return <LiveMark hue={hue} />;

  if (item.status === "completed" && item.polaris)
    return <ConstellationMark size={12} className="text-text-subtle" />;

  return item.status === "completed" ? (
    <CheckIcon size={12} className="text-text-faint" />
  ) : (
    <PixelFailedIcon size={12} className="text-failed" />
  );
};

/** A tool's subject: an image opens in the viewer, another file in the editor, else plain text. */
const Subject = ({ item }: { readonly item: ToolView }) => {
  const [viewing, setViewing] = useState(false);
  const text = "text-code-inline text-text-subtle font-mono";

  if (item.file === null)
    return (
      <span className={cn(text, "truncate")} title={item.full}>
        {item.summary}
      </span>
    );

  if (!item.file.image)
    return (
      <FileLink path={item.file.path} line={item.file.line} className={text}>
        {item.summary}
      </FileLink>
    );

  return (
    <>
      <button
        type="button"
        onClick={() => setViewing(true)}
        title="View image"
        data-testid="image-link"
        className={cn(
          text,
          "hover:text-text-strong min-w-0 cursor-pointer truncate text-left underline-offset-2 hover:underline focus-visible:underline"
        )}
      >
        {item.summary}
      </button>
      {viewing ? <ImageViewer path={item.file.path} onClose={() => setViewing(false)} /> : null}
    </>
  );
};

const Tool = ({ item, hue }: { item: ToolView; hue: Hue }) => (
  <div
    className="flex h-6 min-w-0 items-center gap-2"
    data-testid="tool-call"
    data-status={item.status}
  >
    <ToolMark item={item} hue={hue} />
    <span className="text-caption text-text-subtle shrink-0 font-medium">
      {toolVerb(item.name, item.status === "running")}
    </span>
    <Subject item={item} />
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
  /** Its Turn is the latest: a command stays open until the user folds it. */
  readonly latest?: boolean;
}

/** One item, by kind. */
export const Item = ({ item, hue, onOpenDiff, latest = false }: ItemProps) => {
  switch (item.kind) {
    case "message":
      return <Message text={item.text} live={item.live} />;
    // A landed steer is the user's own row (`rows.tsx`), not an agent item.
    case "user":
      return null;
    case "reasoning":
      return <Reasoning item={item} hue={hue} />;
    case "command":
      return <Command item={item} hue={hue} latest={latest} />;
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
