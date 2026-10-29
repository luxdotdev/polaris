// Portions adapted from shadcn-ui/ui@5563a46 (shadcn@4.21.0, MIT)
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { CheckIcon, ChevronRightIcon, DotIcon } from "../../icons/chrome";
import { cn } from "../../lib/cn";
import { FLOAT_EDGE } from "../../lib/float";
import {
  MENU_CONTENT,
  MENU_DESTRUCTIVE,
  MENU_INDICATOR,
  MENU_ITEM,
  MENU_LABEL,
  MENU_SEPARATOR,
  MENU_SHORTCUT,
} from "../../lib/menu";

/**
 * Non-modal by default: a modal menu locks scrolling and sets `pointer-events` on
 * `<body>`, which restyles the whole document on open and close (~12 ms mid-stream).
 */
export function DropdownMenu({
  modal = false,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root modal={modal} {...props} />;
}

export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

export const DropdownMenuSub = DropdownMenuPrimitive.Sub;

export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  collisionPadding = FLOAT_EDGE,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          MENU_CONTENT,
          "max-h-(--radix-dropdown-menu-content-available-height)",
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export interface DropdownMenuItemProps extends ComponentProps<typeof DropdownMenuPrimitive.Item> {
  readonly inset?: boolean;
  /** It asks for more before it runs; its label ends in "…" (rule/ellipsis-means-input). */
  readonly needsInput?: boolean | undefined;
  /** It can't be undone in Polaris. */
  readonly destructive?: boolean | undefined;
}

export function DropdownMenuItem({
  className,
  inset,
  needsInput,
  destructive,
  ...props
}: DropdownMenuItemProps) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="menu-item"
      data-inset={inset ? "" : undefined}
      data-needs-input={needsInput ? "" : undefined}
      className={cn(MENU_ITEM, destructive && MENU_DESTRUCTIVE, className)}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem className={cn(MENU_ITEM, "pl-8", className)} {...props}>
      <span className={MENU_INDICATOR}>
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem className={cn(MENU_ITEM, "pl-8", className)} {...props}>
      <span className={MENU_INDICATOR}>
        <DropdownMenuPrimitive.ItemIndicator>
          <DotIcon />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return <DropdownMenuPrimitive.Label className={cn(MENU_LABEL, className)} {...props} />;
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn(MENU_SEPARATOR, className)} {...props} />;
}

export function DropdownMenuShortcut({ className, ...props }: ComponentProps<"kbd">) {
  return <kbd className={cn(MENU_SHORTCUT, className)} {...props} />;
}

export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(MENU_ITEM, "data-[state=open]:bg-fill-selected", className)}
      {...props}
    >
      {children}
      <ChevronRightIcon size={12} className="ml-auto" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        alignOffset={-5}
        className={cn(MENU_CONTENT, className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}
