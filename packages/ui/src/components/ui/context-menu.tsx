// Portions adapted from shadcn-ui/ui@5563a46 (shadcn@4.21.0, MIT)
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
import type { ComponentProps, KeyboardEvent } from "react";

import { CheckIcon, ChevronRightIcon, DotIcon } from "../../icons/chrome";
import { cn } from "../../lib/cn";
import {
  MENU_CONTENT,
  MENU_DESTRUCTIVE,
  MENU_INDICATOR,
  MENU_ITEM,
  MENU_LABEL,
  MENU_SEPARATOR,
  MENU_SHORTCUT,
} from "../../lib/menu";

export const ContextMenu = ContextMenuPrimitive.Root;

export const ContextMenuGroup = ContextMenuPrimitive.Group;

export const ContextMenuSub = ContextMenuPrimitive.Sub;

export const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

/** ⇧F10 or the menu key opens the menu on the focused element, as a right-click there would. */
export const openMenuFromKey = (event: KeyboardEvent<HTMLElement>) => {
  const menuKey = event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);

  if (!menuKey || !(event.target instanceof HTMLElement)) return;
  event.preventDefault();
  const rect = event.target.getBoundingClientRect();

  event.target.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + 8,
      clientY: rect.bottom,
    })
  );
};

export function ContextMenuTrigger({
  onKeyDown,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return (
    <ContextMenuPrimitive.Trigger
      onKeyDown={(event) => {
        onKeyDown?.(event);

        if (!event.defaultPrevented) openMenuFromKey(event);
      }}
      {...props}
    />
  );
}

export function ContextMenuContent({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        className={cn(
          MENU_CONTENT,
          "max-h-(--radix-context-menu-content-available-height)",
          className
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

export interface ContextMenuItemProps extends ComponentProps<typeof ContextMenuPrimitive.Item> {
  readonly inset?: boolean;
  /** It asks for more before it runs; its label ends in "…" (rule/ellipsis-means-input). */
  readonly needsInput?: boolean | undefined;
  /** It can't be undone in Polaris (Delete, Discard changes…). */
  readonly destructive?: boolean | undefined;
}

export function ContextMenuItem({
  className,
  inset,
  needsInput,
  destructive,
  ...props
}: ContextMenuItemProps) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="menu-item"
      data-inset={inset ? "" : undefined}
      data-needs-input={needsInput ? "" : undefined}
      className={cn(MENU_ITEM, destructive && MENU_DESTRUCTIVE, className)}
      {...props}
    />
  );
}

export function ContextMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>) {
  return (
    <ContextMenuPrimitive.CheckboxItem className={cn(MENU_ITEM, "pl-8", className)} {...props}>
      <span className={MENU_INDICATOR}>
        <ContextMenuPrimitive.ItemIndicator>
          <CheckIcon />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  );
}

export function ContextMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.RadioItem>) {
  return (
    <ContextMenuPrimitive.RadioItem className={cn(MENU_ITEM, "pl-8", className)} {...props}>
      <span className={MENU_INDICATOR}>
        <ContextMenuPrimitive.ItemIndicator>
          <DotIcon />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  );
}

export function ContextMenuLabel({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Label>) {
  return <ContextMenuPrimitive.Label className={cn(MENU_LABEL, className)} {...props} />;
}

export function ContextMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return <ContextMenuPrimitive.Separator className={cn(MENU_SEPARATOR, className)} {...props} />;
}

export function ContextMenuShortcut({ className, ...props }: ComponentProps<"kbd">) {
  return <kbd className={cn(MENU_SHORTCUT, className)} {...props} />;
}

export function ContextMenuSubTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.SubTrigger>) {
  return (
    <ContextMenuPrimitive.SubTrigger
      className={cn(MENU_ITEM, "data-[state=open]:bg-fill-selected", className)}
      {...props}
    >
      {children}
      <ChevronRightIcon size={12} className="ml-auto" />
    </ContextMenuPrimitive.SubTrigger>
  );
}

export function ContextMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent
        alignOffset={-5}
        className={cn(MENU_CONTENT, className)}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}
