import type { CelestialBody } from "@polaris/protocol";
import type { HTMLAttributes, ReactNode } from "react";

import { ArrowUpIcon, PaperclipIcon } from "../../icons/chrome";
import { cn } from "../../lib/cn";
import type { CssVars } from "../../lib/css";
import { harnessHue, harnessTextVar, hueVar, type Harness } from "../../lib/hue";
import { Button } from "../ui/button";
import { Textarea, type TextareaProps } from "../ui/textarea";
import { Celestial } from "./celestial";
import { Dither } from "./dither";
import { DitherField } from "./dither/field";
import { LiveDither } from "./dither/live";
import { Kbd } from "./kbd";
import { Tile } from "./tile";

export interface HarnessPickerProps extends HTMLAttributes<HTMLButtonElement> {
  readonly harness: Harness;
  /** The Model, as the Harness names it ("Opus 5"). */
  readonly model: string;
  readonly suffix?: ReactNode;
  /** While that Harness is Working the chip takes its hue on the text and a 30% border. */
  readonly working?: boolean;
  /** A session's chip shows its Celestial, still; a new session's shows the Harness tile. */
  readonly celestial?: CelestialBody | undefined;
}

/** DESIGN.md, Chrome redesign: the composer's model chip, a 30px pill; no dither, no chevron. */
export function HarnessPicker({
  harness,
  model,
  suffix,
  working = false,
  celestial,
  className,
  style,
  ...props
}: HarnessPickerProps) {
  const vars: CssVars = {
    "--harness": hueVar(harness),
    "--harness-text": harnessTextVar(harness),
    ...style,
  };

  return (
    <button
      type="button"
      data-slot="harness-picker"
      aria-label={`${harnessHue(harness).name}, ${model}`}
      className={cn(
        CHIP,
        "gap-[7px] pr-row-x pl-gap",
        working && "border-[color-mix(in_oklab,var(--harness)_30%,transparent)]",
        className
      )}
      style={vars}
      {...props}
    >
      {celestial === undefined ? (
        <Tile hue={harness} size={20} className="size-4 rounded-[4px]" />
      ) : (
        <Celestial body={celestial} harness={harness} size={16} />
      )}
      <span
        className={cn(
          "text-caption font-medium",
          working ? "text-(--harness-text)" : "text-text-default"
        )}
      >
        {harnessHue(harness).handle}
      </span>
      <span className="text-caption text-text-subtle">{model}</span>
      {suffix}
    </button>
  );
}

/** The footer's 30px pill: the model chip, the context ring, the permission mode. */
export const CHIP =
  "inline-flex h-[30px] shrink-0 cursor-default items-center rounded-full border border-transparent bg-[light-dark(#0000000a,#ffffff0d)] select-none hover:bg-[light-dark(#00000012,#ffffff17)] data-[state=open]:bg-[light-dark(#00000012,#ffffff17)]";

const RING_CELLS = 20;

/** One arc cell of the ring, clockwise from the top: 18° each, with a hairline gap. */
const ringCell = (index: number) => {
  const point = (radius: number, deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;

    return `${(8 + radius * Math.cos(rad)).toFixed(2)} ${(8 + radius * Math.sin(rad)).toFixed(2)}`;
  };

  const from = index * 18 + 2.5;
  const to = from + 13;

  return `M${point(7.5, from)}A7.5 7.5 0 0 1 ${point(7.5, to)}L${point(4.75, to)}A4.75 4.75 0 0 0 ${point(4.75, from)}Z`;
};

const RING_PATHS = Array.from({ length: RING_CELLS }, (_, i) => ringCell(i));

/** The cells a share of the window fills: any use shows at least one. */
export const ringFilled = (share: number): number =>
  share <= 0 ? 0 : Math.min(RING_CELLS, Math.max(1, Math.round(share * RING_CELLS)));

/** DESIGN.md, The composer: the context as 20 arc cells; nearly full changes the words, never the colour. */
export function ContextRing({ share, className }: { share: number; className?: string }) {
  const filled = ringFilled(share);

  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      aria-hidden="true"
      data-slot="context-ring"
      data-filled={filled}
      className={cn("shrink-0", className)}
    >
      {RING_PATHS.map((d, i) => (
        <path
          key={d}
          d={d}
          className={i < filled ? "fill-text-default" : "fill-[light-dark(#00000014,#ffffff1a)]"}
        />
      ))}
    </svg>
  );
}

export interface WorkingStripProps {
  readonly harness: Harness;
  /** "1m 12s". */
  readonly elapsed: ReactNode;
  readonly onStop?: (() => void) | undefined;
  /** Override the line, as in the Editor ("Claude Code is editing this file"). */
  readonly children?: ReactNode;
  /** Names the status the line shows; a change re-blooms the dither field. */
  readonly status?: string | undefined;
  /** After the elapsed time: what else is running ("2 commands running"). */
  readonly detail?: ReactNode;
  /** Before Stop: the notice strip's "+n" for the notices behind this one. */
  readonly trailing?: ReactNode;
}

/**
 * The composer's 34px Working strip: the loudest thing on a Working screen; no spinner. Its
 * dither field has no band behind it and answers the pointer over any `[data-dither-hover]` ancestor.
 */
export function WorkingStrip({
  harness,
  elapsed,
  onStop,
  children,
  status,
  detail,
  trailing,
}: WorkingStripProps) {
  return (
    <div
      data-slot="working-strip"
      className="gap-row-x pr-gap relative flex h-[42px] shrink-0 items-center overflow-clip pl-[18px]"
    >
      <LiveDither harness={harness} active bloom={status ?? "working"} />
      <Dither hue={harness} size={12} moving className="relative" />
      <span className="text-body relative shrink-0 font-medium whitespace-nowrap text-(--harness-text)">
        {children ?? `${harnessHue(harness).name} is working`}
      </span>
      <span className="text-caption text-text-subtle tabular relative shrink-0 font-mono whitespace-nowrap">
        {elapsed}
      </span>
      {detail === undefined || detail === null ? null : (
        <span
          className="text-caption text-text-subtle tabular relative min-w-0 truncate"
          data-testid="working-detail"
        >
          · {detail}
        </span>
      )}
      <span className="flex-1" />
      {trailing}
      {onStop === undefined ? null : (
        <Button
          variant="secondary"
          size="sm"
          className="h-tree-row px-row-x gap-gap relative rounded-full"
          onClick={onStop}
        >
          <span className="bg-text-default size-2 rounded-[2px]" />
          Stop
          <Kbd variant="plain">esc</Kbd>
        </Button>
      )}
    </div>
  );
}

export interface ShellStripProps {
  /** Where the command runs, and when ("runs in ~/code/x"). */
  readonly where: ReactNode;
  /** The Turn in flight's Stop: a queued command keeps it within reach. */
  readonly onStop?: (() => void) | undefined;
  /** Hover text on the line. */
  readonly title?: string | undefined;
}

/** Shell mode's strip, in the Working strip's place: the `shell` magenta, its dither held still. */
export function ShellStrip({ where, onStop, title }: ShellStripProps) {
  return (
    <div
      data-slot="shell-strip"
      data-testid="shell-strip"
      title={title}
      className="gap-row-x pr-gap relative flex h-[42px] shrink-0 items-center overflow-clip pl-[18px]"
    >
      <DitherField hue="shell" bloom="shell" />
      <Dither hue="shell" size={14} className="relative" />
      <span className="text-caption text-shell-text relative shrink-0 font-medium whitespace-nowrap">
        Shell mode
      </span>
      <span className="text-caption text-text-subtle relative min-w-0 truncate">· {where}</span>
      <span className="flex-1" />
      {onStop === undefined ? (
        <span className="text-caption text-text-subtle relative shrink-0 whitespace-nowrap">
          <Kbd variant="plain">esc</Kbd> to leave
        </span>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          className="relative h-[22px] gap-1.5 px-2"
          onClick={onStop}
        >
          <span className="bg-text-default size-[7px] rounded-[1px]" />
          Stop
          <Kbd variant="plain">esc</Kbd>
        </Button>
      )}
    </div>
  );
}

export interface ComposerProps extends Omit<TextareaProps, "bare"> {
  readonly harness: Harness;
  readonly model: string;
  /** Set while a Turn runs: grows the Working strip and tints the edge in the Harness hue. */
  readonly working?:
    | {
        readonly elapsed: ReactNode;
        readonly onStop?: (() => void) | undefined;
        /** The strip's line instead of "Claude Code is working" (a rotating verb). */
        readonly label?: ReactNode;
        /** After the elapsed time ("2 commands running"). */
        readonly detail?: ReactNode;
      }
    | undefined;
  /** The notice strip, when there is something to know; it replaces the default Working strip. */
  readonly strip?: ReactNode;
  /** Shell mode (a `!` draft): its strip replaces the Working strip and the edge turns `shell`. */
  readonly shell?: Omit<ShellStripProps, "onStop"> | undefined;
  /** The branch or worktree the Turn runs on, in mono (the new-session page). */
  readonly branch?: string | undefined;
  readonly onSend?: () => void;
  /** The paperclip at the input row's end: attach files and images. Unset hides it. */
  readonly onAttach?: (() => void) | undefined;
  /** Replaces the default Harness picker chip, e.g. with one that opens a Model menu. */
  readonly picker?: ReactNode;
  /** Staged attachments, shown above the prompt. */
  readonly attachments?: ReactNode;
  /** Extra controls after the model chip ("Plan first" on the new-session page). */
  readonly tools?: ReactNode;
  /** The footer's right side before Send: running Subagents, the context ring, the permission mode. */
  readonly status?: ReactNode;
  readonly sendDisabled?: boolean;
  /** The new-session page's send: a round primary button (Paper artboard 4). */
  readonly prominentSend?: boolean;
  /** Replaces the textarea with another prompt (the Desktop App's editor); textarea props are then unused. */
  readonly input?: ReactNode;
}

/** The top zone: Shell mode, else the notice strip, else the Working strip. */
const Strip = ({
  harness,
  working,
  strip,
  shell,
}: Pick<ComposerProps, "harness" | "working" | "strip" | "shell">) => {
  if (shell !== undefined)
    return <ShellStrip where={shell.where} title={shell.title} onStop={working?.onStop} />;

  if (strip !== undefined && strip !== null) return strip;

  return working === undefined ? null : (
    <WorkingStrip
      harness={harness}
      elapsed={working.elapsed}
      onStop={working.onStop}
      detail={working.detail}
    >
      {working.label}
    </WorkingStrip>
  );
};

/**
 * The composer (DESIGN.md, Chrome redesign: The composer): a notice strip only when there is
 * something to know, the input with its paperclip, and a footer with the model chip and Send.
 */
export function Composer({
  harness,
  model,
  working,
  strip,
  shell,
  branch,
  onSend,
  onAttach,
  picker,
  attachments,
  tools,
  status,
  sendDisabled = false,
  prominentSend = false,
  input,
  className,
  placeholder,
  ...props
}: ComposerProps) {
  const vars: CssVars = {
    "--harness": hueVar(harness),
    "--harness-text": harnessTextVar(harness),
    "--edge": shell === undefined ? "var(--harness)" : "var(--color-shell)",
  };

  const isWorking = working !== undefined;
  const tinted = isWorking || shell !== undefined;

  return (
    <div
      data-slot="composer"
      data-surface="raised"
      data-working={isWorking ? "" : undefined}
      data-dither-hover={isWorking ? "" : undefined}
      className={cn(
        "@container/composer flex flex-col overflow-clip rounded-[22px] border bg-surface-raised",
        tinted
          ? "border-[color-mix(in_oklab,var(--edge)_28%,transparent)] shadow-[0_0_0_3px_color-mix(in_oklab,var(--edge)_6%,transparent)]"
          : "border-hairline",
        className
      )}
      style={vars}
    >
      <Strip harness={harness} working={working} strip={strip} shell={shell} />
      <div className="gap-row-x pr-panel py-panel flex items-start pl-[calc(var(--spacing-panel)+2px)]">
        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          {attachments}
          {input ?? (
            <Textarea
              bare
              rows={1}
              className="max-h-60"
              placeholder={
                placeholder ??
                (isWorking ? "Queue a follow-up for after this turn" : "Ask for a change")
              }
              {...props}
            />
          )}
        </div>
        {onAttach === undefined ? null : (
          <button
            type="button"
            aria-label="Attach files"
            title="Attach files and images"
            data-testid="composer-attach"
            onClick={onAttach}
            className="text-text-subtle hover:text-text-default hover:bg-fill-hover grid size-6 shrink-0 cursor-default place-items-center rounded-full"
          >
            <PaperclipIcon size={14} />
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5 px-3 pb-3">
        <div className="flex shrink-0 items-center gap-1.5">
          {picker ?? <HarnessPicker harness={harness} model={model} working={isWorking} />}
          {tools}
        </div>
        {/* Status gives way before Send: its chips collapse by container width, then it clips. */}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 overflow-hidden">
          {branch === undefined ? null : (
            <span className="text-micro text-text-subtle truncate font-mono">{branch}</span>
          )}
          {status}
        </div>
        <Button
          variant={prominentSend ? "primary" : "secondary"}
          size="icon"
          aria-label="Send"
          disabled={sendDisabled}
          className={cn(
            "size-row shrink-0 rounded-full",
            !prominentSend &&
              "bg-starlight hover:bg-starlight/90 disabled:bg-fill-selected text-[light-dark(#ffffff,#0d1830)] disabled:text-text-subtle"
          )}
          onClick={onSend}
        >
          <ArrowUpIcon size={14} />
        </Button>
      </div>
    </div>
  );
}
