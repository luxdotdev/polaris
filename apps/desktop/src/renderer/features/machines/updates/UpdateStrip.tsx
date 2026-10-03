/**
 * A Host's Daemon update, under its row's main line: the offer and its one
 * Update button, the work as the still Starlight dither with the step in
 * words (and a bar only from bytes really sent), what it did, or why it
 * stopped with at most one fix (DESIGN.md, Settings · Hosts).
 */
import { Button, Dither, PixelCheckIcon } from "@polaris/ui";
import type { ReactNode } from "react";
import type { FailureAction, UpdateFailure, UpdateLine } from "./model.ts";

/** Indented to the name's edge, so the line reads as part of the Host above it. */
const Strip = ({
  kind,
  children,
}: {
  readonly kind: UpdateLine["kind"];
  readonly children: ReactNode;
}) => (
  <div
    data-testid="daemon-update"
    data-update={kind}
    className="flex min-h-7 items-center gap-2 pb-2.5"
  >
    {children}
  </div>
);

/** Real bytes over the transfer: a 2px track, filled in `text-subtle`, never a signal colour. */
const Bar = ({ fraction }: { readonly fraction: number }) => (
  <span
    role="progressbar"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(fraction * 100)}
    className="bg-fill-selected relative h-0.5 w-[120px] shrink-0 overflow-hidden rounded-full"
  >
    <span
      className="bg-text-subtle absolute inset-y-0 left-0 w-full origin-left transition-transform duration-200"
      style={{ transform: `scaleX(${fraction})` }}
    />
  </span>
);

/** The evidence: a command or the installer's line (as the Needs Attention well). */
const Well = ({ children }: { readonly children: string }) => (
  <pre className="border-hairline bg-surface-sunken text-code-inline text-text-subtle py-row-x rounded-row border px-3 font-mono leading-[18px] whitespace-pre-wrap">
    {children}
  </pre>
);

const Failure = ({
  failure,
  onAction,
}: {
  readonly failure: UpdateFailure;
  readonly onAction: (action: FailureAction) => void;
}) => (
  <div
    data-testid="daemon-update"
    data-update="failed"
    data-reason={failure.reason}
    className="gap-row-x flex flex-col pb-3"
  >
    <p className="text-body text-text-default">
      <span className="text-text-strong font-medium">{failure.title}.</span> {failure.body}
    </p>
    {failure.detail === null ? null : <Well>{failure.detail}</Well>}
    {failure.actions.length === 0 ? null : (
      <div className="gap-gap flex items-center">
        {failure.actions.map((button, index) => (
          <Button
            key={button.action}
            variant={index === 0 ? "secondary" : "ghost"}
            onClick={() => onAction(button.action)}
          >
            {button.label}
          </Button>
        ))}
      </div>
    )}
  </div>
);

export interface UpdateStripProps {
  readonly line: UpdateLine;
  readonly onUpdate: () => void;
  readonly onFailureAction: (action: FailureAction) => void;
}

export const UpdateStrip = ({ line, onUpdate, onFailureAction }: UpdateStripProps) => {
  switch (line.kind) {
    case "none":
      return null;
    case "available":
      return (
        <Strip kind="available">
          <span className="text-caption text-text-default tabular flex-1 truncate">
            {line.text}
            {line.caption === null ? null : (
              <span className="text-text-subtle"> · {line.caption}</span>
            )}
          </span>
          <Button size="sm" disabled={!line.canUpdate} onClick={onUpdate}>
            Upgrade
          </Button>
        </Strip>
      );
    case "busy":
      return (
        <Strip kind="busy">
          <Dither hue="starlight" size={12} />
          <span className="text-caption text-text-default tabular min-w-0 flex-1 truncate">
            {line.text}
          </span>
          {line.fraction === null ? null : <Bar fraction={line.fraction} />}
        </Strip>
      );
    case "updated":
      return (
        <Strip kind="updated">
          <PixelCheckIcon size={12} aria-hidden className="text-text-subtle shrink-0" />
          <span className="text-caption text-text-subtle tabular truncate">{line.text}</span>
        </Strip>
      );
    case "note":
      return (
        <Strip kind="note">
          <span className="text-caption text-text-subtle truncate">{line.text}</span>
        </Strip>
      );
    case "failed":
      return <Failure failure={line.failure} onAction={onFailureAction} />;
  }
};
