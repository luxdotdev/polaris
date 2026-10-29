import type { HTMLAttributes, ReactNode } from "react";
import { Toaster as Sonner, toast as sonner } from "sonner";

import { cn } from "../../lib/cn";
import type { CssVars } from "../../lib/css";
import { harnessHue, type TintHue } from "../../lib/hue";
import { KICKER } from "../../lib/menu";
import { Button } from "../ui/button";

export interface ToastAction {
  readonly label: string;
  readonly onAction: () => void;
  readonly shortcut?: string;
  /** "secondary" for a way in ("Open review") rather than a decision; defaults to "primary". */
  readonly emphasis?: "primary" | "secondary";
}

export interface ToastProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Whose news it is: the Harness that sent it, or Starlight for Polaris. Never good or bad. */
  readonly source: TintHue;
  /** Its Celestial, Harness mark or a pixel icon that, with the words, says what happened. */
  readonly icon: ReactNode;
  /** The sentence; wrap commands and paths in `<code>`. */
  readonly title: ReactNode;
  readonly message?: ReactNode;
  readonly time?: ReactNode;
  /** A session that needs you: the kicker takes the hand and "Needs you". */
  readonly needsYou?: boolean | undefined;
  readonly action?: ToastAction | undefined;
  /** A second way on, beside the action ("Open session"). */
  readonly secondaryAction?: ToastAction | undefined;
}

/** The source as the kicker names it: the Harness's product name, or Polaris for Starlight. */
const sourceName = (source: TintHue) =>
  source === "starlight" ? "Polaris" : harnessHue(source).name;

/** Paper X-F 08's 10px hand, in the Needs You hue. */
const NeedsYouHand = () => (
  <svg
    aria-hidden="true"
    width={10}
    height={10}
    viewBox="0 0 10 10"
    className="text-needs-you shrink-0 [shape-rendering:crispEdges]"
  >
    <path d="M1 2h2v5h-2zM3 0h2v7h-2zM5 1h2v6h-2zM7 3h2v4h-2zM2 7h6v3h-6z" fill="currentColor" />
  </svg>
);

const SENTENCE =
  "text-body leading-5 text-text-default [&_code]:font-mono [&_code]:text-caption [&_code]:text-text-strong";

const ActionButton = ({ action }: { readonly action: ToastAction }) => (
  <Button
    variant={action.emphasis === "secondary" ? "secondary" : "primary"}
    onClick={action.onAction}
    className="h-[30px] rounded-full px-3.5"
  >
    {action.label}
  </Button>
);

const Actions = ({
  action,
  secondary,
}: {
  readonly action: ToastAction | undefined;
  readonly secondary: ToastAction | undefined;
}) => {
  if (action === undefined && secondary === undefined) return null;
  const shortcut = action?.shortcut ?? secondary?.shortcut;

  return (
    <div className="pt-gap gap-gap flex items-center">
      {action === undefined ? null : <ActionButton action={action} />}
      {secondary === undefined ? null : (
        <ActionButton action={{ ...secondary, emphasis: "secondary" }} />
      )}
      <span className="flex-1" />
      {shortcut === undefined ? null : (
        <kbd className="text-text-subtle shrink-0 font-mono text-[11px] leading-[14px]">
          {shortcut}
        </kbd>
      )}
    </div>
  );
};

/**
 * DESIGN.md, Toasts (Paper X-F 08): 380px on the raised surface, the source's 32px mark, a mono
 * kicker (source · Needs you · time), the sentence, then its actions and the key hint at the right.
 */
export function Toast({
  source,
  icon,
  title,
  message,
  time,
  needsYou = false,
  action,
  secondaryAction,
  className,
  ...props
}: ToastProps) {
  return (
    <div
      role="status"
      data-slot="toast"
      className={cn(
        "border-hairline bg-surface-raised shadow-float pt-panel pr-panel flex w-[380px] gap-3.5 rounded-card border pb-3.5 pl-3.5",
        className
      )}
      {...props}
    >
      <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {needsYou ? <NeedsYouHand /> : null}
          <span className={cn(KICKER, "truncate")}>
            {sourceName(source)}
            {needsYou ? " · Needs you" : null}
            {time === undefined ? null : <> · {time}</>}
          </span>
        </div>
        <p className={cn(SENTENCE, "line-clamp-2")}>{title}</p>
        {message === undefined ? null : (
          <p className="text-body text-text-subtle line-clamp-2">{message}</p>
        )}
        <Actions action={action} secondary={secondaryAction} />
      </div>
    </div>
  );
}

const TOASTER_STYLE: CssVars = { "--width": "380px" };

/** The shell moves toasts clear of its bottom and right edges (the Terminal strip, the Output rail). */
const TOASTER_OFFSET = {
  right: "var(--toast-inset-right, 16px)",
  bottom: "var(--toast-inset-bottom, 16px)",
};

/** Mount once. Toasts sit bottom-right and slide on transform only. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      offset={TOASTER_OFFSET}
      gap={8}
      visibleToasts={3}
      toastOptions={{ unstyled: true }}
      style={TOASTER_STYLE}
    />
  );
}

export interface ShowToastOptions extends Omit<ToastProps, "action" | "secondaryAction"> {
  readonly action?: ToastAction;
  readonly secondaryAction?: ToastAction;
  /** Milliseconds; defaults to 6s. */
  readonly duration?: number;
}

/** Show a Polaris toast. Running the action also dismisses it. */
export function showToast({
  duration = 6000,
  action,
  secondaryAction,
  ...props
}: ShowToastOptions) {
  const dismissing = (id: string | number, a: ToastAction | undefined) =>
    a === undefined
      ? undefined
      : {
          ...a,
          onAction: () => {
            a.onAction();
            sonner.dismiss(id);
          },
        };

  return sonner.custom(
    (id) => (
      <Toast
        {...props}
        action={dismissing(id, action)}
        secondaryAction={dismissing(id, secondaryAction)}
      />
    ),
    { duration }
  );
}
