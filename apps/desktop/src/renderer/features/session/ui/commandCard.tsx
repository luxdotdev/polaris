/**
 * A command's whole text in a hover card (DESIGN.md, Turns): its line truncates to one row, so
 * hovering or focusing it opens an instrument card with the command wrapped in mono and a copy
 * action. Only a command its line can't show whole offers it.
 */
import { CopyButton, HoverCard, HoverCardTrigger, InstrumentHoverCardContent } from "@polaris/ui";
import { type ReactElement, type RefObject, useState } from "react";
import { plural } from "../model/format.ts";

/** Whether the line hides some of the command: it has more than one line, or it overflows. */
export const hidesCommand = (command: string, line: HTMLElement | null): boolean => {
  const text = command.trim();

  if (text === "") return false;

  if (text.includes("\n")) return true;

  return line !== null && line.scrollWidth > line.clientWidth;
};

/**
 * `children` is the trigger (the row, or its text while it runs). The card opens only when the
 * line measured at that moment hides part of the command, so short ones never show it.
 */
export const CommandCard = ({
  command,
  status,
  line,
  disabled,
  children,
}: {
  readonly command: string;
  /** The footer's status line: how the command ended ("exit 0", "running"). */
  readonly status: string;
  /** The truncating text, measured when the card would open. */
  readonly line: RefObject<HTMLElement | null>;
  /** The line already shows the whole command (the row is open). */
  readonly disabled: boolean;
  readonly children: ReactElement;
}) => {
  const [open, setOpen] = useState(false);
  const text = command.trim();
  const lines = text.split("\n").length;

  return (
    <HoverCard
      open={open && !disabled}
      onOpenChange={(next) => setOpen(next && !disabled && hidesCommand(command, line.current))}
    >
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <InstrumentHoverCardContent
        data-testid="command-card"
        align="start"
        header={{ title: "Command", state: lines > 1 ? plural(lines, "line") : undefined }}
        wells={[
          <pre
            key="command"
            className="text-code-inline text-text-default max-h-[240px] overflow-auto px-3 py-2 font-mono leading-[18px] break-all whitespace-pre-wrap select-text"
            data-testid="command-card-text"
          >
            {text}
          </pre>,
        ]}
        footer={{
          status,
          action: (
            <CopyButton
              variant="button"
              buttonVariant="ghost"
              buttonSize="sm"
              label="Copy command"
              text={text}
            />
          ),
        }}
      />
    </HoverCard>
  );
};
