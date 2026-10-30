import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "../../../lib/cn";
import { SettingsButton } from "./button";
import { ROW_PAD } from "./tones";

export interface SettingsConfirmRowProps {
  readonly title: ReactNode;
  /** The caption while nothing is asked. */
  readonly caption?: ReactNode;
  /** The row's danger button ("Revoke"). */
  readonly action: string;
  /** The caption while it asks: what goes ("Revoking disconnects it now…"). */
  readonly consequence: ReactNode;
  /** The confirming button, naming its object ("Revoke Even G2"). */
  readonly confirm: string;
  readonly onConfirm: () => void;
  /** Disables the action, with the reason as its caption ("2 agent sessions remain"). */
  readonly disabledReason?: string;
  /** Other row actions beside the danger button ("Unhide"). */
  readonly children?: ReactNode;
}

/**
 * A destructive action confirmed in place, never a modal (SR-Kit 05): the row takes a faint
 * failed tint, its caption becomes the consequence, Cancel holds focus, esc cancels.
 */
export function SettingsConfirmRow({
  title,
  caption,
  action,
  consequence,
  confirm,
  onConfirm,
  disabledReason,
  children,
}: SettingsConfirmRowProps) {
  const [asking, setAsking] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (asking) cancel.current?.focus();
    else if (returnFocus.current) trigger.current?.focus();
  }, [asking]);

  const stop = () => {
    returnFocus.current = true;
    setAsking(false);
  };

  if (!asking)
    return (
      <div data-slot="settings-confirm-row" className={cn("flex items-center gap-3", ROW_PAD)}>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-body text-text-default truncate">{title}</span>
          {(disabledReason ?? caption) === undefined ? null : (
            <span className="text-caption text-text-subtle truncate">
              {disabledReason ?? caption}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {children}
          <SettingsButton
            ref={trigger}
            variant="danger"
            disabled={disabledReason !== undefined}
            onClick={() => setAsking(true)}
          >
            {action}
          </SettingsButton>
        </div>
      </div>
    );

  return (
    <div
      data-slot="settings-confirm-row"
      data-asking=""
      role="group"
      aria-label={confirm}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        stop();
      }}
      className={cn(
        "bg-failed-text/4 flex flex-col gap-[calc(var(--spacing-gap)+2px)]",
        ROW_PAD,
        "pb-[calc(var(--spacing-gap)+6px)]"
      )}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-body text-text-default">{title}</span>
        <span className="text-caption text-text-default">{consequence}</span>
      </div>
      <div className="flex justify-end gap-2">
        <SettingsButton ref={cancel} variant="ghost" onClick={stop}>
          Cancel
        </SettingsButton>
        <SettingsButton
          variant="danger"
          onClick={() => {
            returnFocus.current = false;
            setAsking(false);
            onConfirm();
          }}
        >
          {confirm}
        </SettingsButton>
      </div>
    </div>
  );
}
