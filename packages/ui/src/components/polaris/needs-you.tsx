import type { HTMLAttributes, ReactNode } from "react";

import { PixelHandIcon } from "../../icons/pixel";
import { cn } from "../../lib/cn";
import { harnessHue, type Harness } from "../../lib/hue";
import { Button } from "../ui/button";
import { CodeWell } from "./code-well";
import { Tile } from "./tile";

export interface NeedsYouCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  readonly harness: Harness;
  /** The Agent Session's title. */
  readonly title: ReactNode;
  /** "Host · Workspace · age". */
  readonly where: ReactNode;
  /** An approval: the command, and Approve / Always here / Deny. */
  readonly approval?: {
    readonly command: string;
    readonly onApprove?: () => void;
    readonly onAlwaysAllow?: () => void;
    readonly onDeny?: () => void;
  };
  /** A question: shown here, answered in the conversation (QuestionCard). */
  readonly question?: ReactNode;
  readonly selected?: boolean;
}

/**
 * One waiting session in the Needs You inbox (DESIGN.md, Needs You inbox; Paper 1G2-0). Cards,
 * not rows, because each is an object the user acts on (rule/no-dashboard-clutter).
 */
export function NeedsYouCard({
  harness,
  title,
  where,
  approval,
  question,
  selected = false,
  className,
  ...props
}: NeedsYouCardProps) {
  return (
    <div
      data-slot="needs-you-card"
      data-selected={selected ? "" : undefined}
      className={cn(
        "flex flex-col gap-2.5 rounded-card border bg-surface-raised p-3",
        selected ? "border-text-subtle/40" : "border-hairline",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2.5">
        <Tile hue={harness} size={28}>
          <PixelHandIcon size={14} className="text-needs-you" />
        </Tile>
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <p className="text-label text-text-strong truncate">{title}</p>
          <p className="text-caption text-text-subtle truncate">{where}</p>
        </div>
      </div>
      {approval === undefined ? null : (
        <>
          <CodeWell size="sm" className="border-transparent">
            {approval.command}
          </CodeWell>
          <div className="flex gap-1.5">
            <Button variant="primary" size="xs" onClick={approval.onApprove}>
              Approve
            </Button>
            <Button size="xs" className="px-2" onClick={approval.onAlwaysAllow}>
              Always here
            </Button>
            <span className="flex-1" />
            <Button variant="ghost" size="xs" className="px-1.5" onClick={approval.onDeny}>
              Deny
            </Button>
          </div>
        </>
      )}
      {question === undefined ? null : (
        <p className="text-caption text-text-default leading-[17px]">{question}</p>
      )}
    </div>
  );
}

export interface WaitingCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Failed needs a retry, In Terminal taking back, an Interrupted Turn (after a restart) Continue. */
  readonly kind: "failed" | "in-terminal" | "interrupted";
  /** A 14px glyph: the pixel failed or terminal icon. */
  readonly icon: ReactNode;
  readonly title: ReactNode;
  /** "Failed · out of memory on Pi 4", "In your terminal". */
  readonly detail: ReactNode;
  /** The single action: "Retry" or "Take back". */
  readonly action: { readonly label: string; readonly onAction: () => void };
}

/** A compact "Also waiting on you" card: one line of state and a single action. */
export function WaitingCard({
  kind,
  icon,
  title,
  detail,
  action,
  className,
  ...props
}: WaitingCardProps) {
  return (
    <div
      data-slot="waiting-card"
      data-kind={kind}
      className={cn(
        "flex items-center gap-2.5 rounded-card border border-hairline bg-surface-raised px-3 py-2.5",
        className
      )}
      {...props}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-[8px] border",
          kind === "failed"
            ? "border-failed/14 bg-failed/8 text-failed"
            : "border-transparent bg-surface-sunken text-text-subtle"
        )}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <p className="text-label text-text-strong truncate">{title}</p>
        <p className="text-caption text-text-subtle truncate">{detail}</p>
      </div>
      <Button
        variant="ghost"
        size="xs"
        className="text-text-default px-1.5"
        onClick={action.onAction}
      >
        {action.label}
      </Button>
    </div>
  );
}

export interface QuestionAnswer {
  readonly label: ReactNode;
  readonly recommended?: boolean;
}

export interface QuestionCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  readonly harness: Harness;
  readonly question: ReactNode;
  /** Why it asks, in a sentence or two. */
  readonly context?: ReactNode;
  readonly answers: readonly QuestionAnswer[];
  readonly onAnswer?: (index: number) => void;
  /** "18m". */
  readonly age?: ReactNode;
}

/**
 * A Harness's question in the conversation: a needs-you washed header strip, then numbered
 * answer rows with the recommended one filled (DESIGN.md, Needs You inbox).
 */
export function QuestionCard({
  harness,
  question,
  context,
  answers,
  onAnswer,
  age,
  className,
  ...props
}: QuestionCardProps) {
  return (
    <div
      data-slot="question-card"
      className={cn(
        "flex flex-col overflow-clip rounded-card border border-hairline bg-surface-raised",
        className
      )}
      {...props}
    >
      <div className="pixelated border-needs-you/14 flex h-10 shrink-0 items-center gap-2.5 border-b bg-(image:--wash-needs-you) bg-cover bg-center px-3.5">
        <PixelHandIcon size={14} className="text-needs-you" />
        <span className="text-caption text-text-strong font-medium">
          {harnessHue(harness).name} needs an answer
        </span>
        <span className="flex-1" />
        {age === undefined ? null : (
          <span className="text-caption text-text-subtle tabular">{age}</span>
        )}
      </div>
      <div className="flex flex-col gap-3 p-3.5">
        <p className="text-heading-sm text-text-strong">{question}</p>
        {context === undefined ? null : <p className="text-body text-text-subtle">{context}</p>}
        <ol className="flex flex-col gap-1.5">
          {answers.map((answer, index) => (
            <li key={index}>
              <button
                type="button"
                onClick={() => onAnswer?.(index)}
                className={cn(
                  "flex h-9 w-full cursor-default items-center gap-2.5 rounded-row border px-3 text-left select-none",
                  answer.recommended === true
                    ? "border-transparent bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border-hairline text-text-default hover:bg-fill-hover"
                )}
              >
                <span className="text-micro tabular font-medium opacity-70">{index + 1}</span>
                <span className="text-label flex-1 truncate">{answer.label}</span>
                {answer.recommended === true ? (
                  <span className="text-caption opacity-70">Recommended</span>
                ) : null}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
