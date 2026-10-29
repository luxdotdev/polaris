/**
 * Measures the status row and applies `statusFit`: the branch's shown text and whether
 * Completions keeps its label. Recomputes when the row or its right side changes size.
 */
import { createContext, type RefObject, useContext, useLayoutEffect, useState } from "react";
import { middleTruncate, statusFit, type StatusFit } from "./statusFit.ts";

export const FIT_BRANCH = "branch";

export const FIT_COMPLETIONS = "completions";

export const FIT_SPACER = "spacer";

/** Whether Completions shows its label; the status row's fit decides. */
export const CompletionsFit = createContext<StatusFit["completions"]>("label");

export const useCompletionsFit = () => useContext(CompletionsFit);

let canvas: CanvasRenderingContext2D | null | undefined;

const textWidth = (element: Element, text: string) => {
  canvas ??= document.createElement("canvas").getContext("2d");

  if (canvas === null) return 0;
  const style = getComputedStyle(element);

  // Chromium leaves the `font` shorthand empty when a longhand (tabular numerals) can't be expressed.
  canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

  return canvas.measureText(text).width;
};

const part = (row: HTMLElement, name: string) =>
  row.querySelector<HTMLElement>(`[data-fit="${name}"]`);

interface Shown {
  readonly completions: StatusFit["completions"];
  readonly branch: string | null;
}

/** The row's width left for the branch's text once every other item has its natural width. */
const roomFor = (row: HTMLElement, slot: HTMLElement) => {
  const group = slot.parentElement;
  const style = getComputedStyle(row);
  const gap = Number.parseFloat(style.columnGap) || 0;
  const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
  const items = [...row.children].filter((child) => child instanceof HTMLElement);
  let taken = padding + gap * Math.max(0, items.length - 1);

  for (const item of items) {
    if (item.dataset.fit === FIT_SPACER) continue;

    // The branch's icon and counts keep their width; only its text gives way.
    taken += item === group ? item.offsetWidth - slot.offsetWidth : item.offsetWidth;
  }

  return row.clientWidth - taken;
};

const measure = (row: HTMLElement, branch: string | null, shown: Shown): Shown => {
  const slot = part(row, FIT_BRANCH);
  const completions = part(row, FIT_COMPLETIONS);
  const label = completions?.dataset.fitLabel ?? "";
  const labelWidth = completions === null ? 0 : textWidth(completions, label);

  if (branch === null || slot === null) return { completions: "label", branch: null };

  // While Completions shows its glyph, its label's width is part of what the row gave back.
  const room = roomFor(row, slot) - (shown.completions === "glyph" ? labelWidth : 0);
  const fit = statusFit({ room, branch: textWidth(slot, branch), completionsLabel: labelWidth });

  return {
    completions: fit.completions,
    branch:
      fit.branchRoom === null
        ? branch
        : middleTruncate(branch, fit.branchRoom, (text) => textWidth(slot, text)),
  };
};

export const useStatusFit = (row: RefObject<HTMLElement | null>, branch: string | null): Shown => {
  const [shown, setShown] = useState<Shown>({ completions: "label", branch });

  useLayoutEffect(() => {
    const element = row.current;

    if (element === null) return;

    const update = () =>
      setShown((current) => {
        const next = measure(element, branch, current);

        return next.completions === current.completions && next.branch === current.branch
          ? current
          : next;
      });

    update();
    const observer = new ResizeObserver(update);

    observer.observe(element);

    for (const child of element.children) observer.observe(child);

    return () => observer.disconnect();
  }, [row, branch]);

  return shown;
};
