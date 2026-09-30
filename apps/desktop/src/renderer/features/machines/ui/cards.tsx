/**
 * Local copies of `@polaris/ui`'s HostStateCard, InstallWell and InstallCard
 * from branch `desk/ui-fixes` (Paper 5PM-1, 5FB-1), same props, until that
 * branch lands on main; then import them from `@polaris/ui` and delete this.
 */
import { Button, CodeWell, cn, Dither } from "@polaris/ui";
import type { HTMLAttributes, ReactNode } from "react";

export interface HostStateAction {
  readonly label: string;
  readonly onAction: () => void;
}

export interface HostStateCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** The reason code as a kicker ("host-key-unknown", "installing"). */
  readonly reason: string;
  readonly title: ReactNode;
  readonly body: ReactNode;
  /** The command to run or the stderr line, in a sunken well. */
  readonly detail?: string | undefined;
  /** At most one fix, the primary button. A changed host key never gets a one-click fix. */
  readonly fix?: HostStateAction | undefined;
  readonly secondary?: HostStateAction | undefined;
  /** An install or upgrade in progress. */
  readonly progress?: { readonly label: string } | undefined;
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
        "border-hairline bg-surface-raised flex flex-col gap-2.5 rounded-card border p-4",
        className
      )}
      {...props}
    >
      <p className="text-micro text-text-subtle leading-4">{reason}</p>
      <p className="text-heading-sm text-text-strong">{title}</p>
      <p className="text-body text-text-default">{body}</p>
      {detail === undefined ? null : <CodeWell className="border-transparent">{detail}</CodeWell>}
      {progress === undefined ? null : <Working label={progress.label} />}
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

/**
 * Polaris's own work in progress: the Starlight dither, since the client
 * reports steps, not bytes (a byte bar would guess; DESIGN.md, Dither).
 */
function Working({ label }: { readonly label: string }) {
  return (
    <div role="status" className="flex items-center gap-2">
      <Dither hue="starlight" size={12} />
      <p className="text-caption text-text-subtle">{label}</p>
    </div>
  );
}

export interface InstallFact {
  readonly label: string;
  readonly value: ReactNode;
}

/** What a first install will put on a Host, in a sunken well; the SHA-256 in full. */
export function InstallWell({
  facts,
  className,
  ...props
}: HTMLAttributes<HTMLDListElement> & { readonly facts: ReadonlyArray<InstallFact> }) {
  return (
    <dl
      data-slot="install-well"
      className={cn("rounded-row bg-surface-sunken flex flex-col gap-1.5 px-3.5 py-3", className)}
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
  readonly facts: ReadonlyArray<InstallFact>;
  readonly note?: ReactNode;
  /** "Not now" and "Approve and install". */
  readonly actions: ReactNode;
}

/** The approve-install card (Paper 5FB-1): the facts in a well, a note, and the two buttons. */
export function InstallCard({ facts, note, actions, className, ...props }: InstallCardProps) {
  return (
    <div
      data-slot="install-card"
      className={cn(
        "border-hairline bg-surface-raised flex w-[600px] max-w-full flex-col gap-3.5 rounded-card border p-4",
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
