import type { HTMLAttributes, ReactNode } from "react";

import { ArrowUpIcon, ChevronDownIcon, PlusIcon } from "../../icons/chrome";
import { cn } from "../../lib/cn";
import type { CssVars } from "../../lib/css";
import { harnessHue, harnessTextVar, hueVar, type Harness } from "../../lib/hue";
import { Button } from "../ui/button";
import { Textarea, type TextareaProps } from "../ui/textarea";
import { Dither } from "./dither";
import { DitherField } from "./dither/field";
import { Kbd } from "./kbd";
import { Tile } from "./tile";

export interface HarnessPickerProps extends HTMLAttributes<HTMLButtonElement> {
  readonly harness: Harness;
  /** The Model, as the Harness names it ("Opus 5"). */
  readonly model: string;
  /** While that Harness is Working the chip takes its hue on the text and a 30% border. */
  readonly working?: boolean;
}

/** DESIGN.md, Harness picker: a small tile, the handle, the model and a chevron. */
export function HarnessPicker({
  harness,
  model,
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
      <Tile hue={harness} size={20} className="size-[18px] rounded-[5px]">
        <Dither hue={harness} size={10} moving={working} />
      </Tile>
      <span
        className={cn(
          "text-caption font-medium",
          working ? "text-(--harness-text)" : "text-text-default"
        )}
      >
        {harnessHue(harness).handle}
      </span>
      <span className="text-caption text-text-subtle">{model}</span>
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
}

/**
 * The composer's 34px Working strip: the loudest thing on a Working screen; no spinner. Its
 * dither field has no band behind it and answers the pointer over any `[data-dither-hover]` ancestor.
 */
export function WorkingStrip({ harness, elapsed, onStop, children, status }: WorkingStripProps) {
  return (
    <div
      data-slot="working-strip"
      className="relative flex h-[34px] shrink-0 items-center gap-2 overflow-clip pr-2.5 pl-3"
    >
      <DitherField hue={harness} bloom={status} />
      <Dither hue={harness} size={14} moving className="relative" />
      <span className="text-caption relative font-medium text-(--harness-text)">
        {children ?? `${harnessHue(harness).name} is working`}
      </span>
      <span className="text-caption text-text-subtle tabular relative">· {elapsed}</span>
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
      }
    | undefined;
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
  };

  const isWorking = working !== undefined;

  return (
    <div
      data-slot="composer"
      data-working={isWorking ? "" : undefined}
      data-dither-hover={isWorking ? "" : undefined}
      className={cn(
        "flex flex-col overflow-clip rounded-card border bg-surface-raised",
        isWorking
          ? "border-[color-mix(in_oklab,var(--harness)_28%,transparent)] shadow-[0_0_0_3px_color-mix(in_oklab,var(--harness)_6%,transparent)]"
          : "border-hairline",
        className
      )}
      style={vars}
    >
      {working === undefined ? null : (
        <WorkingStrip harness={harness} elapsed={working.elapsed} onStop={working.onStop}>
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
