import type { HTMLAttributes } from "react";

import { cn } from "../../../lib/cn";

/**
 * The horizon (DESIGN.md, One landscape): the window's foot draws the theme's scene, pinned to the
 * window as the stage's scene is, so the stage's hills run on under the sidebar and the gaps. It
 * draws the scene's foot (`--scene-foot`), recoloured so text over it keeps 4.5:1, fades out
 * upward and is static. It takes no height: put it inside a `relative isolate` container, whose
 * in-flow content paints over it.
 */
export function Horizon({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      data-slot="horizon"
      className={cn(
        "pixelated pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[40vh] bg-(image:--scene-foot) bg-cover bg-fixed bg-bottom bg-no-repeat select-none [mask-image:linear-gradient(to_top,#000_72%,transparent)]",
        className
      )}
      {...props}
    />
  );
}
