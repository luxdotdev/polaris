/**
 * An agent row's content (`model/runs.ts`): one item, a folded tool run that
 * opens to its calls, or a Subagent where the Turn spawned it. A Subagent
 * shows what it is doing while it works and its final report once done; it
 * opens to its task and its own transcript, grouped the same way.
 */
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, cn, PixelFailedIcon } from "@polaris/ui";
import { useState } from "react";
import { chooseCollapse, collapseChoice } from "../model/collapse.ts";
import { formatElapsed } from "../model/format.ts";
import type { Entry } from "../model/runs.ts";
import type { SubagentCard } from "../model/subagents.ts";
import { useElapsed } from "../hooks.ts";
import { type Hue, Item, LiveMark, WELL } from "./items.tsx";
import { Markdown } from "./markdown/index.tsx";

/** Open or closed, remembered per row across the virtualized list's unmounts. */
const useOpen = (key: string, initial: boolean) => {
  const [open, setOpen] = useState(() => collapseChoice(key) ?? initial);

  const toggle = () => {
    chooseCollapse(key, !open);
    setOpen(!open);
  };

  return [open, toggle] as const;
};

const Chevron = ({ open }: { readonly open: boolean }) =>
  open ? (
    <ChevronDownIcon size={10} className="text-text-faint shrink-0" />
  ) : (
    <ChevronRightIcon size={10} className="text-text-faint shrink-0" />
  );

interface Context {
  readonly hue: Hue;
  readonly onOpenDiff: () => void;
}

const Run = ({ entry, ctx }: { entry: Extract<Entry, { kind: "run" }>; ctx: Context }) => {
  const [open, toggle] = useOpen(`run:${entry.id}`, false);

  return (
    <div className="flex flex-col" data-testid="tool-run">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="text-caption text-text-subtle hover:text-text-default flex h-6 min-w-0 cursor-default items-center gap-2 self-start"
      >
        <CheckIcon size={12} className="text-text-faint shrink-0" />
        <span className="truncate">{entry.summary}</span>
        <Chevron open={open} />
      </button>
      {open ? (
        <div className="border-hairline mt-1 ml-1.5 flex flex-col gap-1.5 border-l pl-3.5">
          {entry.items.map((item) => (
            <Item key={item.id} item={item} hue={ctx.hue} onOpenDiff={ctx.onOpenDiff} />
          ))}
        </div>
      ) : null}
    </div>
  );
};

const STATUS_LABEL = {
  working: "working",
  completed: "done",
  failed: "failed",
  interrupted: "stopped",
} as const;

const StatusMark = ({ card, hue }: { card: SubagentCard; hue: Hue }) => {
  switch (card.subagent.status) {
    case "working":
      return <LiveMark hue={hue} />;
    case "completed":
      return <CheckIcon size={14} className="text-text-subtle shrink-0" />;
    case "failed":
    case "interrupted":
      return <PixelFailedIcon size={14} className="text-failed shrink-0" />;
  }
};

const Elapsed = ({ card }: { card: SubagentCard }) => {
  const { startedAt, endedAt, status } = card.subagent;
  const running = useElapsed(startedAt, status === "working");
  const ms = endedAt === null ? running : Date.parse(endedAt) - Date.parse(startedAt);

  return (
    <span className="text-caption text-text-subtle tabular shrink-0">{formatElapsed(ms)}</span>
  );
};

const Subagent = ({ card, ctx }: { card: SubagentCard; ctx: Context }) => {
  const [open, toggle] = useOpen(`subagent:${card.id}`, false);
  const { subagent } = card;

  return (
    <div
      className={cn(WELL, "flex flex-col overflow-clip")}
      data-testid="subagent"
      data-status={subagent.status}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="h-row gap-row-x hover:bg-fill-hover flex min-w-0 cursor-default items-center px-3 text-left"
      >
        <StatusMark card={card} hue={ctx.hue} />
        <span className="text-caption text-text-default shrink-0 font-medium">
          {subagent.agent ?? "Subagent"}
        </span>
        <span className="text-body text-text-subtle min-w-0 flex-1 truncate">{subagent.title}</span>
        <Elapsed card={card} />
        {subagent.status === "working" ? null : (
          <span className="text-caption text-text-subtle shrink-0">
            {STATUS_LABEL[subagent.status]}
          </span>
        )}
        <Chevron open={open} />
      </button>
      {card.activity === null ? null : (
        <p
          className="text-caption text-text-subtle -mt-1.5 truncate px-3 pb-2 pl-[38px] font-mono"
          data-testid="subagent-activity"
        >
          {card.activity}
        </p>
      )}
      {open ? (
        <div
          className="border-hairline flex flex-col gap-1.5 border-t px-3 py-2"
          data-testid="subagent-transcript"
        >
          {card.task === null ? null : (
            <p className="text-caption text-text-subtle border-hairline line-clamp-4 border-l-2 pl-3 whitespace-pre-wrap">
              {card.task}
            </p>
          )}
          {card.entries.map((entry) => (
            <EntryView key={entryId(entry)} entry={entry} ctx={ctx} />
          ))}
          {card.entries.length === 0 && card.report === null ? (
            <p className="text-caption text-text-subtle">Nothing yet</p>
          ) : null}
        </div>
      ) : null}
      {card.report === null ? null : (
        <div className="border-hairline text-body border-t px-3 py-2" data-testid="subagent-report">
          <Markdown text={card.report} live={false} />
        </div>
      )}
    </div>
  );
};

const entryId = (entry: Entry) => {
  switch (entry.kind) {
    case "item":
      return entry.item.id;
    case "run":
      return `run:${entry.id}`;
    case "subagent":
      return `subagent:${entry.card.id}`;
  }
};

export const EntryView = ({ entry, ctx }: { readonly entry: Entry; readonly ctx: Context }) => {
  switch (entry.kind) {
    case "item":
      return <Item item={entry.item} hue={ctx.hue} onOpenDiff={ctx.onOpenDiff} />;
    case "run":
      return <Run entry={entry} ctx={ctx} />;
    case "subagent":
      return <Subagent card={entry.card} ctx={ctx} />;
  }
};
