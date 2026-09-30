import type { ConnectionState } from "@polaris/protocol";
import type { HTMLAttributes, ReactNode } from "react";

import { PixelKeyIcon } from "../../icons/pixel";
import { cn } from "../../lib/cn";
import { Button } from "../ui/button";
import { CodeWell } from "./code-well";

export type { ConnectionState };

export interface HostStateChipProps extends HTMLAttributes<HTMLElement> {
  /** The Host's name, as the user named it ("Linux VM"). */
  readonly host: string;
  readonly state: ConnectionState;
  /** Reconnecting: the elapsed time ("12s"). Offline: since when ("09:14"). */
  readonly since?: string | undefined;
  /** Needs Attention opens its inline card. */
  readonly onOpen?: () => void;
}

/**
 * A Host's label in the workspace bar, carrying its Connection State (Paper 5PM-1). Never a
 * modal: Needs Attention is a chip that opens the inline HostStateCard.
 */
export function HostStateChip({
  host,
  state,
  since,
  onOpen,
  className,
  ...props
}: HostStateChipProps) {
  if (state === "needs-attention") {
    return (
      <button
        type="button"
        data-slot="host-state-chip"
        data-state={state}
        onClick={onOpen}
        className={cn(
          "inline-flex h-7 shrink-0 cursor-default items-center gap-1.5 rounded-control border border-text-subtle/30 px-2.5 whitespace-nowrap select-none hover:bg-fill-hover",
          className
        )}
        {...props}
      >
        <PixelKeyIcon size={12} className="text-text-strong" />
        <span className="text-label text-text-strong">{host}</span>
        <span className="text-caption text-text-default">Needs attention</span>
      </button>
    );
  }

  return (
    <span
      data-slot="host-state-chip"
      data-state={state}
      className={cn(
        "inline-flex shrink-0 items-center pr-1.5 pl-1 text-caption whitespace-nowrap text-text-subtle",
        className
      )}
      {...props}
    >
      {host}
      {state === "reconnecting" ? ` · reconnecting${since === undefined ? "" : ` ${since}`}` : null}
      {state === "offline" ? ` · offline${since === undefined ? "" : ` since ${since}`}` : null}
    </span>
  );
}

export interface HostStateAction {
  readonly label: string;
  readonly onAction: () => void;
}

export interface HostStateCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** The reason code as a kicker ("host-key-unknown", "installing"). */
  readonly reason: string;
  /** What happened, in one sentence ("Linux VM's host key changed"). */
  readonly title: ReactNode;
  /** What it means and what to do. */
  readonly body: ReactNode;
  /** The command to run or the stderr line, in a sunken well. */
  readonly detail?: string;
  /** At most one fix, the primary button. A changed host key never gets a one-click fix. */
  readonly fix?: HostStateAction;
  /** A secondary action: retry, copy the command, view the log, cancel. */
  readonly secondary?: HostStateAction;
  /** An install or upgrade in progress: 0..1, with its caption and time left. */
  readonly progress?: { readonly value: number; readonly label: string; readonly eta?: string };
}

/** The inline card for a Needs Attention reason (DESIGN.md, Onboarding; Paper 5PM-1). */
export function HostStateCard({
  reason,
  title,
  body,
  detail,
  fix,
  secondary,
  progress,
  className,
  ...props
}: HostStateCardProps) {
  return (
    <div
      data-slot="host-state-card"
      data-reason={reason}
      className={cn(
        "flex flex-col gap-2.5 rounded-card border border-hairline bg-surface-raised p-4",
        className
      )}
      {...props}
    >
      <p className="text-micro text-text-subtle leading-4">{reason}</p>
      <p className="text-heading-sm text-text-strong">{title}</p>
      <p className="text-body text-text-default">{body}</p>
      {detail === undefined ? null : <CodeWell className="border-transparent">{detail}</CodeWell>}
      {progress === undefined ? null : <Progress {...progress} />}
      {fix === undefined && secondary === undefined ? null : (
        <div className="flex gap-2">
          {fix === undefined ? null : (
            <Button variant="primary" onClick={fix.onAction}>
              {fix.label}
            </Button>
          )}
          {secondary === undefined ? null : (
            <Button onClick={secondary.onAction}>{secondary.label}</Button>
          )}
        </div>
      )}
    </div>
  );
}

interface ProgressProps {
  readonly value: number;
  readonly label: string;
  readonly eta?: string;
}

/** Polaris's own work, so the bar is Starlight (DESIGN.md, Primary). */
function Progress({ value, label, eta }: ProgressProps) {
  const clamped = Math.min(Math.max(value, 0), 1);

  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped * 100)}
        aria-label={label}
        className="bg-surface-sunken h-1 overflow-clip rounded-full"
      >
        <div
          className="bg-starlight h-full w-full origin-left transition-transform duration-200 ease-out"
          style={{ transform: `scaleX(${clamped})` }}
        />
      </div>
      <div className="text-caption text-text-subtle tabular flex justify-between">
        <span>{label}</span>
        {eta === undefined ? null : <span>{eta}</span>}
      </div>
    </div>
  );
}
