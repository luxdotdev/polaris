/**
 * A command in the conversation: its line with how it ended, and its output
 * tail in a well. Once it succeeds the output folds to that line after a
 * moment (`model/collapse.ts`); a click on the line opens or folds it.
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

export const Command = ({ item, hue }: { readonly item: CommandView; readonly hue: Hue }) => {
  const running = item.live || item.status === "running";
  const failed = item.status === "failed" || (item.exitCode !== null && item.exitCode !== 0);
  const { settled, hover } = useSettled(!running);
  const [choice, setChoice] = useState(() => collapseChoice(item.id));
  const hasOutput = item.output !== "";
  const open = outputOpen({ running, failed, settled, choice });
  const canFold = hasOutput && !running;

  const toggle = () => {
    chooseCollapse(item.id, !open);
    setChoice(!open);
  };

  const line = (
    <>
      <StatusMark item={item} failed={failed} hue={hue} />
      <span className="text-code-inline text-text-default flex-1 truncate font-mono">
        {item.command === "" ? "Running a command" : `$ ${item.command}`}
      </span>
      {canFold && !open ? (
        <span className="text-caption text-text-subtle tabular">
          {plural(lineCount(item.output), "line")}
        </span>
      ) : null}
      <span className="text-caption text-text-subtle tabular">{exitLabel(item)}</span>
      {canFold ? (
        open ? (
          <ChevronDownIcon size={10} className="text-text-faint shrink-0" />
        ) : (
          <ChevronRightIcon size={10} className="text-text-faint shrink-0" />
        )
      ) : null}
    </>
  );

  return (
    <div
      className={cn(WELL, "flex flex-col overflow-clip")}
      data-testid="command"
      data-folded={canFold && !open ? "" : undefined}
      {...hover}
    >
      {canFold ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={toggle}
          className="h-row gap-row-x hover:bg-fill-hover flex cursor-default items-center px-3 text-left"
        >
          {line}
        </button>
      ) : (
        <div className="h-row gap-row-x flex items-center px-3">{line}</div>
      )}
      {hasOutput && open ? <Output output={item.output} /> : null}
    </div>
  );
};
