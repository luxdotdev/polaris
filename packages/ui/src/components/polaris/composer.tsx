import type { HTMLAttributes, ReactNode } from "react";

import { ArrowUpIcon, ChevronDownIcon, PlusIcon } from "../../icons/chrome";
import { cn } from "../../lib/cn";
import type { CssVars } from "../../lib/css";
import { harnessHue, harnessTextVar, hueVar, type Harness } from "../../lib/hue";
import { Button } from "../ui/button";
import { Textarea, type TextareaProps } from "../ui/textarea";
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
}

/** DESIGN.md, Harness picker: a small tile, the handle, the model and a chevron; no dither. */
export function HarnessPicker({
  harness,
  model,
  suffix,
  working = false,
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
        "inline-flex h-[26px] shrink-0 cursor-default items-center gap-1.5 rounded-control border bg-fill-selected pr-2 pl-1 select-none",
        working
          ? "border-[color-mix(in_oklab,var(--harness)_30%,transparent)]"
          : "border-transparent hover:bg-fill-selected/70",
        className
      )}
      style={vars}
      {...props}
    >
      <Tile hue={harness} size={20} className="size-[18px] rounded-[5px]" />
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
      <ChevronDownIcon size={10} className="text-text-subtle" />
    </button>
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
}: WorkingStripProps) {
  return (
    <div
      data-slot="working-strip"
      className="relative flex h-[34px] shrink-0 items-center gap-2 overflow-clip pr-2.5 pl-3"
    >
      <LiveDither harness={harness} active bloom={status ?? "working"} />
      <Dither hue={harness} size={14} moving className="relative" />
      <span className="text-caption relative shrink-0 font-medium whitespace-nowrap text-(--harness-text)">
        {children ?? `${harnessHue(harness).name} is working`}
      </span>
      <span className="text-caption text-text-subtle tabular relative shrink-0 whitespace-nowrap">
        · {elapsed}
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
      {onStop === undefined ? null : (
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
      className="relative flex h-[34px] shrink-0 items-center gap-2 overflow-clip pr-2.5 pl-3"
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
  /** Shell mode (a `!` draft): its strip replaces the Working strip and the edge turns `shell`. */
  readonly shell?: Omit<ShellStripProps, "onStop"> | undefined;
  /** The branch or worktree the Turn runs on, in mono. */
  readonly branch?: string | undefined;
  readonly onSend?: () => void;
  readonly onAddSource?: () => void;
  /** Replaces the default Harness picker chip, e.g. with one that opens a Model menu. */
  readonly picker?: ReactNode;
  /** Staged attachments, shown above the prompt. */
  readonly attachments?: ReactNode;
  /** Extra controls after "Add a source" ("Plan first" on the new-session page). */
  readonly tools?: ReactNode;
  readonly sendDisabled?: boolean;
  /** The new-session page's send: a round primary button (Paper artboard 4). */
  readonly prominentSend?: boolean;
  /** Replaces the textarea with another prompt (the Desktop App's editor); textarea props are then unused. */
  readonly input?: ReactNode;
}

/** The composer shell: the Harness picker, the prompt, and send (DESIGN.md, Working strip). */
export function Composer({
  harness,
  model,
  working,
  shell,
  branch,
  onSend,
  onAddSource,
  picker,
  attachments,
  tools,
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
      data-working={isWorking ? "" : undefined}
      data-dither-hover={isWorking ? "" : undefined}
      className={cn(
        "flex flex-col overflow-clip rounded-card border bg-surface-raised",
        tinted
          ? "border-[color-mix(in_oklab,var(--edge)_28%,transparent)] shadow-[0_0_0_3px_color-mix(in_oklab,var(--edge)_6%,transparent)]"
          : "border-hairline",
        className
      )}
      style={vars}
    >
      {shell === undefined ? null : (
        <ShellStrip where={shell.where} title={shell.title} onStop={working?.onStop} />
      )}
      {working === undefined || shell !== undefined ? null : (
        <WorkingStrip
          harness={harness}
          elapsed={working.elapsed}
          onStop={working.onStop}
          detail={working.detail}
        >
          {working.label}
        </WorkingStrip>
      )}
      <div className="flex flex-col gap-3.5 pt-3 pr-3 pb-2.5 pl-3.5">
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
        <div className="flex items-center gap-1.5">
          {picker ?? <HarnessPicker harness={harness} model={model} working={isWorking} />}
          <Button variant="ghost" size="icon-sm" aria-label="Add a source" onClick={onAddSource}>
            <PlusIcon size={14} />
          </Button>
          {tools}
          <span className="flex-1" />
          {branch === undefined ? null : (
            <span className="text-micro text-text-subtle truncate font-mono">{branch}</span>
          )}
          <Button
            variant={prominentSend ? "primary" : "secondary"}
            size="icon"
            aria-label="Send"
            disabled={sendDisabled}
            className={prominentSend ? "size-[30px] rounded-full" : "rounded-full"}
            onClick={onSend}
          >
            <ArrowUpIcon size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}
