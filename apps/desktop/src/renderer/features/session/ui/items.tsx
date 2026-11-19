/**
 * One Turn item in the conversation (DESIGN.md, Turns in the conversation):
 * prose, a folded "Thought" disclosure, commands with their output tail, file
 * changes by git letter, tool calls, the step checklist and errors.
 */
import { CopyButton, PixelFailedIcon } from "@polaris/ui";
import { type ItemView } from "../model/items.ts";
import { Command } from "./command.tsx";
import { CommandChanges } from "./commandChanges.tsx";
import { FileChanges } from "./fileEdits/index.ts";
import { type Hue } from "./marks.tsx";
import { Markdown } from "./markdown/index.tsx";
import { Plan } from "./plan.tsx";
import { PolarisTool } from "./polarisTool/index.tsx";
import { Reasoning } from "./reasoning.tsx";
import { softWrap } from "./softWrap.tsx";
import { Tool } from "./tool.tsx";
import { Visualization } from "./visualization/index.tsx";

export { type Hue, LiveMark, WELL } from "./marks.tsx";

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
        className="bg-panel absolute -top-1 right-0 opacity-0 group-hover/message:opacity-100 focus-visible:opacity-100 data-[copy-state=copied]:opacity-100 data-[copy-state=failed]:opacity-100"
      />
    )}
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
  /** Opens a file in the Changes panel; absent where there is none (a Subagent's own view). */
  readonly onOpenFile?: ((path: string) => void) | undefined;
}

/** One item, by kind. */
export const Item = ({ item, hue, onOpenDiff, onOpenFile }: ItemProps) => {
  switch (item.kind) {
    case "message":
      return <Message text={item.text} live={item.live} />;
    // A landed steer is the user's own row (`rows.tsx`), not an agent item.
    case "user":
      return null;
    case "reasoning":
      return <Reasoning item={item} hue={hue} />;
    case "command":
      return item.changes === undefined || item.changes.length === 0 ? (
        <Command item={item} hue={hue} />
      ) : (
        <div className="flex flex-col gap-1.5">
          <Command item={item} hue={hue} />
          <CommandChanges item={item} hue={hue} onOpenFile={onOpenFile} onOpenDiff={onOpenDiff} />
        </div>
      );
    case "files":
      return (
        <FileChanges
          id={item.id}
          changes={item.changes}
          status={item.status}
          writing={item.writing}
          hue={hue}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
        />
      );
    case "tool":
      if (item.visualization !== null) return <Visualization view={item.visualization} hue={hue} />;

      return item.view === null ? (
        <Tool item={item} hue={hue} />
      ) : (
        <PolarisTool id={item.id} view={item.view} hue={hue} />
      );
    case "plan":
      return <Plan item={item} hue={hue} />;
    case "error":
      return <ErrorItem message={item.message} />;
  }
};
