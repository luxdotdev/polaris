/**
 * A command in the conversation: its line with how it ended, and its output
 * tail in a well. Once it succeeds the output folds to that line after a
 * moment (`model/collapse.ts`); a click on the line opens or folds it, and
 * open, the line wraps to the whole command.
 */
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, cn, PixelFailedIcon } from "@polaris/ui";
import { useEffect, useRef, useState } from "react";
import {
  chooseCollapse,
  COLLAPSE_DELAY_MS,
  collapseChoice,
  outputOpen,
} from "../model/collapse.ts";
import { plural } from "../model/format.ts";
import { type ItemView, outputTail } from "../model/items.ts";
import { type Hue, LiveMark, WELL } from "./items.tsx";

type CommandView = Extract<ItemView, { kind: "command" }>;

const TAIL_LINES = 8;

const exitLabel = (item: CommandView): string => {
  if (item.status === "declined") return "declined";

  if (item.live || item.status === "running") return "running";

  return item.exitCode === null ? item.status : `exit ${item.exitCode}`;
};

const lineCount = (output: string) =>
  (output.endsWith("\n") ? output.slice(0, -1) : output).split("\n").length;

/**
 * Whether the fold's delay has passed: at once for a command already done when
 * it mounts; for one seen finishing, after the delay and once the pointer has
 * left it, so nothing folds under the reader.
 */
const useSettled = (done: boolean) => {
  const doneAtMount = useRef(done);
  const [elapsed, setElapsed] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!done || doneAtMount.current) return undefined;
    const timer = setTimeout(() => setElapsed(true), COLLAPSE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [done]);

  return {
    settled: doneAtMount.current || (elapsed && !hovered),
    hover: {
      onPointerEnter: () => setHovered(true),
      onPointerLeave: () => setHovered(false),
    },
  };
};

const Output = ({ output }: { readonly output: string }) => {
  const [all, setAll] = useState(false);
  const tail = outputTail(output, TAIL_LINES);

  return (
    <div className="border-hairline border-t" data-testid="command-output">
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
        {all ? output : tail.text}
      </pre>
    </div>
  );
};

const StatusMark = ({ item, failed, hue }: { item: CommandView; failed: boolean; hue: Hue }) => {
  if (item.live) return <LiveMark hue={hue} />;

  return failed ? (
    <PixelFailedIcon size={14} className="text-failed" />
  ) : (
    <CheckIcon size={14} className="text-text-subtle" />
  );
};

/** Whether the command is open, and its toggle: `model/collapse.ts`, with the user's choice. */
const useFold = (item: CommandView) => {
  const running = item.live || item.status === "running";
  const failed = item.status === "failed" || (item.exitCode !== null && item.exitCode !== 0);
  const hasOutput = item.output !== "";
  const { settled, hover } = useSettled(!running);
  const [choice, setChoice] = useState(() => collapseChoice(item.id));

  // Without output there's nothing to show unless asked: only the whole command.
  const open = hasOutput ? outputOpen({ running, failed, settled, choice }) : (choice ?? false);

  const toggle = () => {
    chooseCollapse(item.id, !open);
    setChoice(!open);
  };

  return { running, failed, hasOutput, open, toggle, hover };
};

const Line = ({
  item,
  hue,
  failed,
  open,
  canFold,
}: {
  readonly item: CommandView;
  readonly hue: Hue;
  readonly failed: boolean;
  readonly open: boolean;
  readonly canFold: boolean;
}) => (
  <>
    <StatusMark item={item} failed={failed} hue={hue} />
    <span
      className={cn(
        "text-code-inline text-text-default min-w-0 flex-1 font-mono",
        open ? "py-1.5 break-all whitespace-pre-wrap" : "truncate"
      )}
      data-testid="command-text"
    >
      {item.command === "" ? "Running a command" : `$ ${item.command}`}
    </span>
    {item.output !== "" && canFold && !open ? (
      <span className="text-caption text-text-subtle tabular">
        {plural(lineCount(item.output), "line")}
      </span>
    ) : null}
    <span className="text-caption text-text-subtle tabular">{exitLabel(item)}</span>
    {canFold ? <Chevron open={open} /> : null}
  </>
);

const Chevron = ({ open }: { readonly open: boolean }) =>
  open ? (
    <ChevronDownIcon size={10} className="text-text-faint shrink-0" />
  ) : (
    <ChevronRightIcon size={10} className="text-text-faint shrink-0" />
  );

export const Command = ({ item, hue }: { readonly item: CommandView; readonly hue: Hue }) => {
  const { running, failed, hasOutput, open, toggle, hover } = useFold(item);
  // Always, so a long command can be read whole even with no output.
  const canFold = !running;
  const line = <Line item={item} hue={hue} failed={failed} open={open} canFold={canFold} />;

  return (
    <div
      className={cn(WELL, "flex flex-col overflow-clip")}
      data-testid="command"
      data-menu-command={item.id}
      data-folded={canFold && !open ? "" : undefined}
      {...hover}
    >
      {canFold ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={toggle}
          title={open ? undefined : item.command}
          className="min-h-row gap-row-x hover:bg-fill-hover flex cursor-default items-center px-3 text-left"
        >
          {line}
        </button>
      ) : (
        <div className="min-h-row gap-row-x flex items-center px-3">{line}</div>
      )}
      {hasOutput && open ? <Output output={item.output} /> : null}
      {!hasOutput && open ? (
        <p className="text-caption text-text-subtle border-hairline border-t px-3 py-1.5">
          No output
        </p>
      ) : null}
    </div>
  );
};
