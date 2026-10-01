import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

/**
 * The full-bleed pixel scene: a night sky with Polaris in dark mode, a meadow at dawn in light.
 * Only in onboarding, first run and stage empty states; never behind working surfaces.
 */
export function Scene({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="scene"
      className={cn(
        "pixelated relative isolate overflow-hidden bg-(image:--scene) bg-cover bg-bottom",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface ClearingProps extends HTMLAttributes<HTMLDivElement> {
  /** Extra room around the text block; DESIGN.md sizes the clearing to the text plus 80px. */
  readonly bleed?: number;
}

/**
 * rule/scene-text-contrast: text set directly on a scene sits on a solid radial vignette of
 * the scene's darkest colour. Secondary lines on it use text-default, not text-subtle.
 */
export function Clearing({ bleed = 80, className, children, style, ...props }: ClearingProps) {
  return (
    <div data-slot="clearing" className={cn("relative", className)} style={style} {...props}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -z-10"
        style={{
          inset: -bleed,
          background:
            "radial-gradient(closest-side, color-mix(in oklab, var(--scene-clearing) 90%, transparent) 55%, transparent)",
        }}
      />
      {children}
    </div>
  );
}
