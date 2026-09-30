import type { HTMLAttributes } from "react";

import { PixelPolarisIcon } from "../../icons/pixel";
import { cn } from "../../lib/cn";

export interface WordmarkProps extends HTMLAttributes<HTMLSpanElement> {
  /** 13px in the title bar; larger in About and onboarding. */
  readonly size?: number;
  /** Onboarding and brand moments track the wordmark at −0.01em; the title bar doesn't. */
  readonly moment?: boolean;
}

/**
 * The horizontal lockup: the flat star leading "Polaris" in Geist Pixel. Only where Polaris
 * names itself (title bar, About, onboarding), never in working copy.
 */
export function Wordmark({ size = 13, moment = false, className, ...props }: WordmarkProps) {
  const mark = Math.max(16, Math.round((size * 16) / 13 / 16) * 16);

  return (
    <span
      data-slot="wordmark"
      className={cn("inline-flex items-center gap-1.5 text-text-default", className)}
      {...props}
    >
      <PixelPolarisIcon size={mark} className="text-starlight" />
      <span
        className={cn("font-pixel", moment && "tracking-[-0.01em]")}
        style={{ fontSize: size, lineHeight: `${mark}px` }}
      >
        Polaris
      </span>
    </span>
  );
}
