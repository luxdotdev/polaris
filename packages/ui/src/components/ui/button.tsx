// Portions adapted from shadcn-ui/ui@5563a46 (shadcn@4.21.0, MIT)
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "../../lib/cn";

/**
 * DESIGN.md, Buttons. Hover fills change instantly: only transform and opacity animate.
 * Focus is the global 2px Starlight ring; Starlight never fills a button (rule/starlight-is-rare).
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 cursor-default items-center justify-center gap-1.5 rounded-control text-label whitespace-nowrap select-none disabled:pointer-events-none disabled:opacity-(--opacity-dimmed) [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** Monochrome fill. At most one per view. */
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-fill-selected text-text-default hover:bg-fill-selected/70",
        /** No fill until hover. */
        ghost: "text-text-subtle hover:bg-fill-hover hover:text-text-default",
        /** A destructive action that names its object: secondary shape, failed-text label. */
        danger: "bg-fill-selected text-failed-text hover:bg-fill-selected/70",
      },
      size: {
        default: "h-7 px-3",
        /** Floating layers and strips, as in Paper's toast and stop control. */
        sm: "h-[26px] px-2.5 text-caption font-medium",
        /** Inside inbox cards (Paper 1G2-0: 24px, 12px). */
        xs: "h-6 px-2.5 text-caption font-medium",
        /**
         * Brand moments only (onboarding, the site): with variant "primary", 36px, 8px radius and
         * the float shadow, the one button that casts one. End it with a ButtonKeycap.
         */
        brand:
          "h-9 gap-2.5 rounded-[8px] pr-3.5 pl-[18px] text-[color:light-dark(#ffffff,#17181a)] shadow-[0_8px_24px_light-dark(rgb(0_0_0/12%),rgb(0_0_0/35%))]",
        /** A 16px icon in a 28px square. */
        icon: "size-7",
        "icon-sm": "size-[26px]",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  }
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { readonly asChild?: boolean };

export function Button({
  className,
  variant = "secondary",
  size = "default",
  asChild = false,
  type = "button",
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      type={asChild ? undefined : type}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

/** The trailing 18px keycap of a brand-moment button ("Get started ↵"). */
export function ButtonKeycap({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="button-keycap"
      className={cn(
        "inline-flex size-[18px] shrink-0 items-center justify-center rounded-[4px] font-sans text-micro font-medium",
        // Paper 571-1 / 5OY-1: ink at 8% on the Snow button, white at 12% on the Ink one.
        "bg-[light-dark(#ffffff1f,#17181a14)] text-[color:light-dark(#a4a6ac,#74767d)]",
        className
      )}
      {...props}
    />
  );
}
