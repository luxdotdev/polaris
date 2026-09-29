import type { HTMLAttributes, ReactNode } from "react";
import { Toaster as Sonner, toast as sonner } from "sonner";

import { cn } from "../../lib/cn";
import type { CssVars } from "../../lib/css";
import { hueVar, washVar, type TintHue } from "../../lib/hue";
import { Button } from "../ui/button";
import { Kbd } from "./kbd";

export interface ToastAction {
  readonly label: string;
  readonly onAction: () => void;
  readonly shortcut?: string;
}

export interface ToastProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Whose news it is: the Harness that sent it, or Starlight for Polaris. Never good or bad. */
  readonly source: TintHue;
  /** A pixel icon that, with the words, says what happened. */
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly message?: ReactNode;
  readonly time?: ReactNode;
  /** At most one action. */
  readonly action?: ToastAction | undefined;
}

/**
 * DESIGN.md, Toasts: 360px, card radius, surface-raised with the float shadow, a full-height
 * pixel tile washed in the source's hue, a heading title, one body line and one action.
 */
export function Toast({
  source,
  icon,
  title,
  message,
  time,
  action,
  className,
  style,
  ...props
}: ToastProps) {
  const vars: CssVars = { "--toast-hue": hueVar(source), ...style };

  return (
    <div
      role="status"
      data-slot="toast"
      className={cn(
        "flex w-[360px] overflow-clip rounded-card border border-hairline bg-surface-raised shadow-float",
        className
      )}
      style={vars}
      {...props}
    >
      <div
        aria-hidden="true"
        className="pixelated flex w-16 shrink-0 items-center justify-center border-r border-[color-mix(in_oklab,var(--toast-hue)_18%,transparent)] bg-cover bg-center bg-origin-border"
        style={{ backgroundImage: washVar(source) }}
      >
        {icon}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 px-3.5 py-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <p className="text-heading text-text-strong min-w-0 flex-1 truncate">{title}</p>
            {time === undefined ? null : (
              <span className="text-caption text-text-faint shrink-0">{time}</span>
            )}
          </div>
          {message === undefined ? null : (
            <p className="text-body text-text-subtle line-clamp-2">{message}</p>
          )}
        </div>
        {action === undefined ? null : (
          <div className="flex items-center gap-1.5">
            <Button variant="primary" onClick={action.onAction}>
              {action.label}
            </Button>
            <span className="flex-1" />
            {action.shortcut === undefined ? null : <Kbd variant="plain">{action.shortcut}</Kbd>}
          </div>
        )}
      </div>
    </div>
  );
}

const TOASTER_STYLE: CssVars = { "--width": "360px" };

/** Mount once. Toasts sit top-right and slide on transform only. */
export function Toaster() {
  return (
    <Sonner
      position="top-right"
      offset={16}
      gap={8}
      visibleToasts={3}
      toastOptions={{ unstyled: true }}
      style={TOASTER_STYLE}
    />
  );
}

export interface ShowToastOptions extends Omit<ToastProps, "action"> {
  readonly action?: ToastAction;
  /** Milliseconds; defaults to 6s. */
  readonly duration?: number;
}

/** Show a Polaris toast. Running the action also dismisses it. */
export function showToast({ duration = 6000, action, ...props }: ShowToastOptions) {
  return sonner.custom(
    (id) => (
      <Toast
        {...props}
        action={
          action === undefined
            ? undefined
            : {
                ...action,
                onAction: () => {
                  action.onAction();
                  sonner.dismiss(id);
                },
              }
        }
      />
    ),
    { duration }
  );
}
