import type { ReactNode } from "react";

import { CheckIcon, CloseIcon, CopyIcon } from "../../icons/chrome";
import { cn } from "../../lib/cn";
import { type CopyState, useCopy } from "../../lib/copy";
import { Button, type ButtonProps } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export interface CopyButtonProps {
  /** What to copy; a function is read at click time (a log copies what it shows then). */
  readonly text: string | (() => string);
  /** The idle label, also the icon variant's accessible name. */
  readonly label?: string;
  /**
   * `inline`: a small fill beside the text it copies (an install command). `icon`: a 16px icon
   * in a ghost square (a code block's header). `button`: a Button, keeping its variant and size.
   */
  readonly variant?: "inline" | "icon" | "button";
  readonly buttonVariant?: ButtonProps["variant"];
  readonly buttonSize?: ButtonProps["size"];
  readonly className?: string;
  /** How long "Copied" or "Couldn't copy" stays; 1500ms everywhere in the app. */
  readonly resetMs?: number;
}

export const COPIED = "Copied";

export const COPY_FAILED = "Couldn't copy";

/** One face of the button; every face shares one grid cell, so the width never changes. */
const Face = ({
  shown,
  className,
  children,
}: {
  readonly shown: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) => (
  <span
    aria-hidden="true"
    data-face
    data-shown={shown}
    className={cn(
      "col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5 transition-[opacity,transform] duration-160 ease-out",
      shown ? "scale-100 opacity-100" : "scale-90 opacity-0",
      className
    )}
  >
    {children}
  </span>
);

const Faces = ({
  state,
  idle,
  copied,
  failed,
}: Record<CopyState, ReactNode> & { state: CopyState }) => (
  <span className="grid">
    <Face shown={state === "idle"}>{idle}</Face>
    <Face shown={state === "copied"} className="text-text-strong">
      {copied}
    </Face>
    <Face shown={state === "failed"} className="text-failed-text">
      {failed}
    </Face>
  </span>
);

const said = (state: CopyState, label: string) =>
  ({ idle: label, copied: COPIED, failed: COPY_FAILED })[state];

/** Press: a 120ms dip to 97%; the faces cross over 160ms (DESIGN.md, Copy button). */
const PRESS = "transition-transform duration-120 ease-out active:scale-[0.97]";

/**
 * Copies `text` and says so in place for 1.5s: "Copied", or "Couldn't copy" when the write
 * fails. A screen reader hears the same through a polite live region.
 */
export function CopyButton({
  text,
  label = "Copy",
  variant = "inline",
  buttonVariant,
  buttonSize,
  className,
  resetMs,
}: CopyButtonProps) {
  const { state, copy } = useCopy(undefined, resetMs === undefined ? {} : { resetMs });
  const onClick = () => copy(text instanceof Function ? text() : text);

  const status = (
    <span role="status" aria-live="polite" className="sr-only">
      {state === "idle" ? "" : said(state, label)}
    </span>
  );

  if (variant === "icon") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            data-copy-state={state}
            onClick={onClick}
            className={cn(PRESS, className)}
          >
            <Faces
              state={state}
              idle={<CopyIcon />}
              copied={<CheckIcon />}
              failed={<CloseIcon />}
            />
            {status}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{said(state, label)}</TooltipContent>
      </Tooltip>
    );
  }

  const faces = <Faces state={state} idle={label} copied={COPIED} failed={COPY_FAILED} />;

  if (variant === "button") {
    return (
      <Button
        variant={buttonVariant}
        size={buttonSize}
        aria-label={label}
        data-copy-state={state}
        onClick={onClick}
        className={cn(PRESS, className)}
      >
        {faces}
        {status}
      </Button>
    );
  }

  return (
    <button
      type="button"
      aria-label={label}
      data-copy-state={state}
      onClick={onClick}
      className={cn(
        "bg-fill-selected text-caption text-text-default focus-visible:outline-starlight inline-flex h-[22px] shrink-0 cursor-default items-center rounded-[4px] px-2 focus-visible:outline-2",
        PRESS,
        className
      )}
    >
      {faces}
      {status}
    </button>
  );
}
