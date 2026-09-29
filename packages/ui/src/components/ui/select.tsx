// Portions adapted from shadcn-ui/ui@5563a46 (shadcn@4.21.0, MIT)
import { Select as SelectPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "../../icons/chrome";
import { cn } from "../../lib/cn";
import {
  MENU_CONTENT,
  MENU_INDICATOR,
  MENU_ITEM,
  MENU_LABEL,
  MENU_SEPARATOR,
} from "../../lib/menu";

export const Select = SelectPrimitive.Root;

export const SelectGroup = SelectPrimitive.Group;

export const SelectValue = SelectPrimitive.Value;

/** A 28px control like Input, with a chevron. */
export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex h-7 w-fit cursor-default items-center justify-between gap-2 rounded-control border border-hairline bg-bg pr-2 pl-2.5 text-label whitespace-nowrap text-text-default",
        "hover:bg-fill-hover disabled:opacity-(--opacity-dimmed) data-[placeholder]:text-text-faint",
        "*:data-[slot=select-value]:truncate",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon size={12} className="text-text-subtle" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  sideOffset = 6,
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        sideOffset={sideOffset}
        className={cn(
          MENU_CONTENT,
          "relative max-h-(--radix-select-content-available-height) p-0",
          className
        )}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="text-text-subtle flex h-6 items-center justify-center">
          <ChevronUpIcon size={12} />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport
          className={cn(
            "p-1.5",
            position === "popper" && "w-full min-w-(--radix-select-trigger-width)"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="text-text-subtle flex h-6 items-center justify-center">
          <ChevronDownIcon size={12} />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectLabel({ className, ...props }: ComponentProps<typeof SelectPrimitive.Label>) {
  return <SelectPrimitive.Label className={cn(MENU_LABEL, className)} {...props} />;
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item className={cn(MENU_ITEM, "pl-8", className)} {...props}>
      <span className={MENU_INDICATOR}>
        <SelectPrimitive.ItemIndicator>
          <CheckIcon />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export function SelectSeparator({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator className={cn(MENU_SEPARATOR, className)} {...props} />;
}
