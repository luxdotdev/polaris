// Portions adapted from shadcn-ui/ui@5563a46 (shadcn@4.21.0, MIT)
import { Command as CommandPrimitive } from "cmdk";
import type { ComponentProps, ReactNode } from "react";

import { SearchIcon } from "../../icons/chrome";
import { cn } from "../../lib/cn";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./dialog";

export function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn("flex size-full flex-col overflow-hidden text-text-default", className)}
      {...props}
    />
  );
}

export interface CommandDialogProps extends ComponentProps<typeof Dialog> {
  readonly title?: string;
  readonly description?: string;
  readonly className?: string;
  readonly children: ReactNode;
  /** cmdk's own filtering; turn off to rank results yourself. */
  readonly shouldFilter?: boolean | undefined;
  /** An element that opens it, such as the title bar's jump field. */
  readonly trigger?: ReactNode;
}

/** The K jump menu (artboard 3): a 620px card hung from the top over a flat scrim. */
export function CommandDialog({
  title = "Jump",
  description = "Jump to a session, workspace, host or action",
  children,
  className,
  shouldFilter,
  trigger,
  ...props
}: CommandDialogProps) {
  return (
    <Dialog {...props}>
      {trigger === undefined ? null : <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent placement="top" className={cn("w-[620px]", className)}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Command shouldFilter={shouldFilter ?? true}>{children}</Command>
      </DialogContent>
    </Dialog>
  );
}

export interface CommandInputProps extends ComponentProps<typeof CommandPrimitive.Input> {
  /** What the menu covers, shown on the right ("Sessions, workspaces, hosts, actions"). */
  readonly hint?: ReactNode;
}

export function CommandInput({ className, hint, ...props }: CommandInputProps) {
  return (
    <div className="border-hairline flex h-[52px] shrink-0 items-center gap-2.5 border-b px-4">
      <SearchIcon className="text-text-subtle" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent text-heading font-regular text-text-strong caret-starlight outline-hidden placeholder:text-text-faint",
          className
        )}
        {...props}
      />
      {hint === undefined ? null : (
        <span className="text-caption text-text-faint shrink-0">{hint}</span>
      )}
    </div>
  );
}

export function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "max-h-[420px] scroll-py-2 overflow-x-hidden overflow-y-auto px-2 pt-1.5 pb-2",
        className
      )}
      {...props}
    />
  );
}

/** The inline empty state: one caption line. */
export function CommandEmpty({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      className={cn("px-2.5 py-3 text-caption text-text-faint", className)}
      {...props}
    />
  );
}

export function CommandGroup({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-3.5 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:text-text-subtle first:[&_[cmdk-group-heading]]:pt-2.5",
        className
      )}
      {...props}
    />
  );
}

export function CommandSeparator({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      className={cn("-mx-2 my-1 h-px bg-hairline", className)}
      {...props}
    />
  );
}

export interface CommandItemProps extends ComponentProps<typeof CommandPrimitive.Item> {
  /** A 16px state glyph or icon. */
  readonly leading?: ReactNode;
  /** Where it lives, in caption ("Mac Studio / polaris"). */
  readonly detail?: ReactNode;
  /** Right-aligned status ("Needs you · Codex") or a shortcut. */
  readonly meta?: ReactNode;
}

/** A 36px result row; the highlighted row takes fill-selected and shows ↵. */
export function CommandItem({
  className,
  leading,
  detail,
  meta,
  children,
  ...props
}: CommandItemProps) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "group/item flex h-9 cursor-default items-center gap-2.5 rounded-row px-2.5 text-label text-text-default outline-hidden select-none",
        "data-[selected=true]:bg-fill-selected data-[selected=true]:text-text-strong data-[disabled=true]:opacity-(--opacity-dimmed)",
        className
      )}
      {...props}
    >
      {leading === undefined ? null : (
        <span className="text-text-subtle flex w-4 shrink-0 items-center justify-center">
          {leading}
        </span>
      )}
      <span className="truncate">{children}</span>
      {detail === undefined ? null : (
        <span className="text-caption text-text-faint group-data-[selected=true]/item:text-text-subtle truncate">
          {detail}
        </span>
      )}
      <span className="flex-1" />
      {meta === undefined ? null : (
        <span className="text-caption text-text-faint group-data-[selected=true]/item:text-text-subtle shrink-0">
          {meta}
        </span>
      )}
      <kbd className="text-micro text-text-faint hidden w-3 font-sans group-data-[selected=true]/item:inline">
        ↵
      </kbd>
    </CommandPrimitive.Item>
  );
}

/** The key-hint footer: "↑↓ Move", "↵ Open", "esc". */
export function CommandFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-center gap-4 border-t border-hairline bg-[color-mix(in_oklab,var(--color-surface-raised),var(--color-surface-sunken)_40%)] px-4 text-caption text-text-faint",
        className
      )}
      {...props}
    />
  );
}
