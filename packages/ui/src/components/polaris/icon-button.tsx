import type { ReactNode } from "react";

import { Button, type ButtonProps } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export interface IconButtonProps extends Omit<ButtonProps, "size" | "children"> {
  /** The accessible name, also shown as the tooltip. */
  readonly label: string;
  /** A 16px icon. */
  readonly icon: ReactNode;
  readonly size?: "default" | "sm";
  readonly shortcut?: string;
}

/** A ghost button holding a 16px icon in a 28px square, labelled by a tooltip. */
export function IconButton({
  label,
  icon,
  size = "default",
  shortcut,
  variant = "ghost",
  ...props
}: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          variant={variant}
          size={size === "sm" ? "icon-sm" : "icon"}
          {...props}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent shortcut={shortcut}>{label}</TooltipContent>
    </Tooltip>
  );
}
