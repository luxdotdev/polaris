import { type RefObject, useEffect } from "react";

/** The toaster's width (`@polaris/ui` Toaster) and the gap kept above the composer. */
const TOAST_WIDTH = 380;

const GAP = 8;

export interface Box {
  readonly top: number;
  readonly left: number;
  readonly right: number;
}

/**
 * The toaster's bottom inset that keeps toasts above a composer under their column, so a burst
 * never covers Send; null when the composer sits clear of the column.
 */
export const toastInsetBottom = (
  composer: Box,
  viewport: { readonly width: number; readonly height: number },
  insetRight: number
): number | null => {
  const columnRight = viewport.width - insetRight;
  const columnLeft = columnRight - TOAST_WIDTH;

  if (composer.right <= columnLeft || composer.left >= columnRight) return null;

  return Math.max(0, Math.round(viewport.height - composer.top + GAP));
};

const INSET_RIGHT = "--toast-inset-right";

const INSET_BOTTOM = "--toast-inset-bottom";

/** Lifts the toaster over the composer while it is mounted, following its size and the window's. */
export const useToastsClear = (ref: RefObject<HTMLElement | null>) =>
  useEffect(() => {
    const element = ref.current;

    if (element === null) return;
    const root = document.documentElement;

    const place = () => {
      const right = Number.parseFloat(getComputedStyle(root).getPropertyValue(INSET_RIGHT));

      const inset = toastInsetBottom(
        element.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        Number.isFinite(right) ? right : 16
      );

      if (inset === null) root.style.removeProperty(INSET_BOTTOM);
      else root.style.setProperty(INSET_BOTTOM, `${inset}px`);
    };

    const observer = new ResizeObserver(place);

    observer.observe(element);
    window.addEventListener("resize", place);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      root.style.removeProperty(INSET_BOTTOM);
    };
  }, [ref]);
