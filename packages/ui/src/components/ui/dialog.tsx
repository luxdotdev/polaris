// Portions adapted from shadcn-ui/ui@5563a46 (shadcn@4.21.0, MIT)
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { CloseIcon } from "../../icons/chrome";
import { cn } from "../../lib/cn";
import { FLOAT_SURFACE } from "../../lib/float";

/**
 * A modal for a deliberate choice the user opened (a confirmation, the jump menu). Never for
 * Connection State: Needs Attention is always inline on the Host (CONTEXT.md).
 */
export const Dialog = DialogPrimitive.Root;

export const DialogTrigger = DialogPrimitive.Trigger;

export const DialogClose = DialogPrimitive.Close;

export const DialogPortal = DialogPrimitive.Portal;

/** The scrim: flat, no blur (the jump menu's is Paper's "Scrim (no blur)"). */
export function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-scrim duration-200 ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  );
}

export interface DialogContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  /** "center" for confirmations; "top" hangs it 132px from the top, like the jump menu. */
  readonly placement?: "center" | "top";
  readonly showClose?: boolean;
}

export function DialogContent({
  className,
  children,
  placement = "center",
  showClose = false,
  ...props
}: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed left-1/2 z-50 flex w-[440px] max-w-[calc(100%-32px)] -translate-x-1/2 flex-col overflow-clip",
          placement === "center" ? "top-1/2 -translate-y-1/2" : "top-[132px]",
          FLOAT_SURFACE,
          // The card stays opaque while it enters: it scales in, only the scrim fades.
          "duration-200 ease-out data-[state=open]:animate-in data-[state=open]:zoom-in-[0.98]",
          className
        )}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            aria-label="Close"
            className="rounded-control text-text-subtle hover:bg-fill-hover hover:text-text-default absolute top-3 right-3 flex size-7 items-center justify-center"
          >
            <CloseIcon />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1 px-5 pt-5 pb-3", className)} {...props} />;
}

/** The footer holds at most one primary button, on the right. */
export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-1.5 border-t border-hairline px-5 py-3",
        className
      )}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title className={cn("text-title text-text-strong", className)} {...props} />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-body text-text-subtle", className)}
      {...props}
    />
  );
}
