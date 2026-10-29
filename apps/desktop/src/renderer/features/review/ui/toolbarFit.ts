/**
 * The pull request toolbar's fit: when the status group and the actions don't fit side by side
 * at their natural widths, the control marked `data-fit="collapses"` (Reviewers) drops to its
 * icon. Past that the row wraps the actions under the status, and the checkout chip truncates.
 */
import { createContext, type RefObject, useContext, useLayoutEffect, useState } from "react";

/** Whether the toolbar's collapsing control shows only its icon. */
export const ToolbarCompact = createContext(false);

export const useToolbarCompact = () => useContext(ToolbarCompact);

/** Marks the control that collapses first; its full width is remembered while it is collapsed. */
export const FIT_COLLAPSES = "collapses";

const gapOf = (element: HTMLElement) => Number.parseFloat(getComputedStyle(element).columnGap) || 0;

/** An item's width with everything CSS truncated inside it given back. */
const natural = (item: HTMLElement) =>
  [...item.querySelectorAll<HTMLElement>(".truncate")].reduce(
    (width, cut) => width + Math.max(0, cut.scrollWidth - cut.clientWidth),
    item.offsetWidth
  );

/** The row's width with each group's items whole, the collapsing control at `full` px. */
const needed = (row: HTMLElement, collapses: HTMLElement, full: number) => {
  const groups = [...row.children].filter((child) => child instanceof HTMLElement);
  let total = gapOf(row) * Math.max(0, groups.length - 1);

  for (const group of groups) {
    const items = [...group.children].filter((child) => child instanceof HTMLElement);

    total += gapOf(group) * Math.max(0, items.length - 1);

    for (const item of items) total += item === collapses ? full : natural(item);
  }

  return total;
};

/** Observes the toolbar `row` (its groups are its children) and says whether to collapse. */
export const useToolbarFit = (row: RefObject<HTMLElement | null>): boolean => {
  const [compact, setCompact] = useState(false);

  useLayoutEffect(() => {
    const element = row.current;

    if (element === null) return;
    let full = 0;

    const update = () => {
      const collapses = element.querySelector<HTMLElement>(`[data-fit="${FIT_COLLAPSES}"]`);

      if (collapses === null) return setCompact(false);

      if (collapses.dataset.compact !== "true") full = collapses.offsetWidth;
      setCompact(needed(element, collapses, full) > element.clientWidth);
    };

    update();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);

    observer.observe(element);

    for (const group of element.children) observer.observe(group);

    return () => observer.disconnect();
  }, [row]);

  return compact;
};
