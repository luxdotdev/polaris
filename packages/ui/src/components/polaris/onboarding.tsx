import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";
import { Clearing } from "./scene";
import { Tile } from "./tile";

export interface StageHeadingProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** The Starlight kicker ("Set up · Mac Studio", "New session · polaris"). */
  readonly kicker: ReactNode;
  /** The display headline ("Where does your code live?"). */
  readonly title: ReactNode;
  /** One line saying where or what (text-default, rule/scene-text-contrast). */
  readonly line?: ReactNode;
}

/** The headline of a stage empty state, set on a clearing over the scene. */
export function StageHeading({ kicker, title, line, className, ...props }: StageHeadingProps) {
  return (
    <Clearing
      data-slot="stage-heading"
      className={cn("flex flex-col items-center gap-2 text-center", className)}
      {...props}
    >
      <p className="text-caption text-starlight-text font-medium">{kicker}</p>
      <h1 className="text-display text-text-strong tracking-[-0.015em]">{title}</h1>
      {line === undefined ? null : <p className="text-body text-text-default">{line}</p>}
    </Clearing>
  );
}

/** The first-run setup card (DESIGN.md, Onboarding; Paper 57Q-1): a raised card of rows. */
export function SetupCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="setup-card"
      className={cn(
        "flex w-[600px] max-w-full flex-col overflow-clip rounded-card border border-hairline bg-surface-raised [&>*+*]:border-t [&>*+*]:border-hairline",
        className
      )}
      {...props}
    />
  );
}

export interface SetupRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** A 20px white pixel glyph for the 40px Starlight-washed tile. */
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly caption: ReactNode;
  /** The row's button; the first row's is the view's one primary. */
  readonly action?: ReactNode;
  /** Locked until something else exists: a dashed tile and the reason instead of a button. */
  readonly locked?: ReactNode;
}

export function SetupRow({
  icon,
  title,
  caption,
  action,
  locked,
  className,
  ...props
}: SetupRowProps) {
  const isLocked = locked !== undefined;

  return (
    <div
      data-slot="setup-row"
      data-locked={isLocked ? "" : undefined}
      className={cn("flex items-center gap-3.5 px-4 py-3.5", className)}
      {...props}
    >
      {isLocked ? (
        <span className="rounded-row border-text-subtle/30 bg-fill-hover text-text-subtle flex size-10 shrink-0 items-center justify-center border border-dashed">
          {icon}
        </span>
      ) : (
        <Tile hue="starlight" size={40} borderless className="text-text-strong">
          {icon}
        </Tile>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className={cn("text-heading-sm", isLocked ? "text-text-subtle" : "text-text-strong")}>
          {title}
        </p>
        <p className="text-caption text-text-subtle truncate">{caption}</p>
      </div>
      {isLocked ? <span className="text-caption text-text-subtle shrink-0">{locked}</span> : action}
    </div>
  );
}

export interface InstallFact {
  readonly label: string;
  readonly value: ReactNode;
}

export interface InstallWellProps extends HTMLAttributes<HTMLDListElement> {
  /** Platform, version, SHA-256 and install path, in that order. */
  readonly facts: readonly InstallFact[];
}

/**
 * What a first install will put on a Host, in a sunken well (Paper 5FB-1). The SHA-256 is
 * shown in full so the user can check it.
 */
export function InstallWell({ facts, className, ...props }: InstallWellProps) {
  return (
    <dl
      data-slot="install-well"
      className={cn("flex flex-col gap-1.5 rounded-row bg-surface-sunken px-3.5 py-3", className)}
      {...props}
    >
      {facts.map((fact) => (
        <div key={fact.label} className="text-caption flex gap-3 leading-5">
          <dt className="text-text-subtle w-[72px] shrink-0">{fact.label}</dt>
          <dd className="text-text-strong tabular whitespace-pre-wrap">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface InstallCardProps extends HTMLAttributes<HTMLDivElement> {
  readonly facts: readonly InstallFact[];
  /** "Copied from this Mac, nothing downloaded. Asked once; upgrades install on their own." */
  readonly note?: ReactNode;
  /** "Not now" and "Approve and install". */
  readonly actions: ReactNode;
}

/** The approve-install card: the facts in a well, a note, and the two buttons. */
export function InstallCard({ facts, note, actions, className, ...props }: InstallCardProps) {
  return (
    <div
      data-slot="install-card"
      className={cn(
        "flex w-[600px] max-w-full flex-col gap-3.5 rounded-card border border-hairline bg-surface-raised p-4",
        className
      )}
      {...props}
    >
      <InstallWell facts={facts} />
      <div className="flex items-center gap-2">
        <p className="text-caption text-text-subtle flex-1">{note}</p>
        {actions}
      </div>
    </div>
  );
}
