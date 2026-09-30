/**
 * One Host in Settings · Hosts (Paper S4, 7CV-1): name and "ssh alias · N
 * workspaces", Daemon version, Connection State, and a trailing lane. Lanes
 * are fixed widths so they align across rows.
 */
import {
  ChevronDownIcon,
  cn,
  PixelAlertIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@polaris/ui";
import type { ReactNode } from "react";
import type { MachineView } from "../../../shared/api.ts";
import { type ConnectionLine, connectionLine, workspacesText } from "./model.ts";

export const LANES = {
  daemon: "w-[84px] shrink-0",
  connection: "w-[220px] shrink-0",
  trailing: "w-tree-row shrink-0 flex justify-center",
} as const;

/** The state mark: filled dot, hollow dot, dashed dot, or the pixel alert (rule/no-colour-alone). */
const StateMark = ({ state }: { readonly state: ConnectionLine["state"] }) => {
  if (state === "needs-attention") {
    return <PixelAlertIcon size={12} aria-hidden className="text-text-default shrink-0" />;
  }

  return (
    <span
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        state === "connected" && "bg-text-subtle",
        state === "reconnecting" && "border-text-subtle border",
        (state === "offline" || state === "off") && "border-text-faint border border-dashed"
      )}
    />
  );
};

const DotsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="text-text-subtle">
    <circle cx="3" cy="7" r="1.1" fill="currentColor" />
    <circle cx="7" cy="7" r="1.1" fill="currentColor" />
    <circle cx="11" cy="7" r="1.1" fill="currentColor" />
  </svg>
);

interface TrailingProps extends Pick<
  HostRowProps,
  "machine" | "expanded" | "onToggle" | "onRetry" | "onRemove"
> {
  /** Show the chevron (expanded, or something needs the user) instead of the menu. */
  readonly open: boolean;
}

/** The chevron while open, else the overflow menu (Details, Retry now, Remove host). */
const Trailing = ({ machine, open, expanded, onToggle, onRetry, onRemove }: TrailingProps) => (
  <span className={LANES.trailing}>
    {open ? (
      <button
        type="button"
        aria-label={expanded ? "Hide details" : "Show details"}
        onClick={onToggle}
        className="text-text-subtle hover:bg-fill-hover rounded-control flex size-6 cursor-default items-center justify-center"
      >
        <ChevronDownIcon
          size={14}
          className={cn("transition-transform duration-120", expanded && "rotate-180")}
        />
      </button>
    ) : (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${machine.label} actions`}
          className="hover:bg-fill-hover rounded-control flex size-6 cursor-default items-center justify-center"
        >
          <DotsIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onToggle}>Details</DropdownMenuItem>
          <DropdownMenuItem onSelect={onRetry} disabled={machine.status === null}>
            Retry now
          </DropdownMenuItem>
          {onRemove === null ? null : (
            <DropdownMenuItem onSelect={onRemove} className="text-failed">
              Remove host
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )}
  </span>
);

const nameTone = (attention: boolean, quiet: boolean) => {
  if (attention) return "text-text-strong";

  return quiet ? "text-text-subtle" : "text-text-default";
};

export interface HostRowProps {
  readonly machine: MachineView;
  readonly workspaces: number | null;
  readonly now: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onRetry: () => void;
  readonly onRemove: (() => void) | null;
  readonly children?: ReactNode;
}

export const HostRow = ({
  machine,
  workspaces,
  now,
  expanded,
  onToggle,
  onRetry,
  onRemove,
  children,
}: HostRowProps) => {
  const line = connectionLine(machine, now);
  const attention = line.state === "needs-attention";
  const quiet = line.state === "offline" || line.state === "off";

  return (
    <li
      data-testid={`machine-${machine.key}`}
      data-state={line.state}
      className={cn("border-hairline border-t first:border-t-0", expanded && "bg-fill-hover/60")}
    >
      <div
        className={cn(
          // 52 at calm (Paper S4): the session row's density token plus the caption's leading.
          "px-panel flex min-h-[calc(var(--spacing-session-row)+4px)] items-center",
          line.state === "reconnecting" && "opacity-(--opacity-dimmed)"
        )}
      >
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex min-w-0 flex-1 cursor-default flex-col gap-0.5 py-1.5 text-left"
        >
          <span className="flex items-center gap-1.5">
            {machine.colour === null ? null : (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-[2px]"
                style={{ background: machine.colour }}
              />
            )}
            <span className={cn("text-label truncate", nameTone(attention, quiet))}>
              {machine.label}
            </span>
          </span>
          <span className="text-caption text-text-subtle truncate">
            {machine.alias === null ? (
              "This Mac"
            ) : (
              <>
                ssh <span className="text-code-inline font-mono">{machine.alias}</span>
              </>
            )}
            {workspaces === null ? null : ` · ${workspacesText(workspaces)}`}
          </span>
        </button>
        <span className={cn(LANES.daemon, "text-caption text-text-subtle tabular")}>
          {machine.status?.host?.daemonVersion ?? "—"}
        </span>
        <span
          className={cn(LANES.connection, "flex items-center gap-gap")}
          data-testid={`connection-state-${machine.key}`}
        >
          <StateMark state={line.state} />
          <span
            className={cn(
              "text-body",
              attention ? "text-text-strong font-medium" : "text-text-default"
            )}
          >
            {line.label}
          </span>
          {line.caption === null ? null : (
            <span className="text-caption text-text-subtle tabular truncate">
              {line.caption}
              {line.retry ? (
                <>
                  {" · "}
                  <button
                    type="button"
                    onClick={onRetry}
                    className="text-text-default cursor-default hover:underline"
                  >
                    Retry
                  </button>
                </>
              ) : null}
            </span>
          )}
        </span>
        <Trailing
          machine={machine}
          open={expanded || attention}
          expanded={expanded}
          onToggle={onToggle}
          onRetry={onRetry}
          onRemove={onRemove}
        />
      </div>
      {expanded ? <div className="px-panel pb-panel flex flex-col gap-3">{children}</div> : null}
    </li>
  );
};
