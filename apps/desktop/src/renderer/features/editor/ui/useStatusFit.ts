/**
 * Measures the status row and applies `statusFit`: the branch's shown text, the Host name's cap,
 * whether Completions keeps its label, and which items drop (`statusDrops`). Recomputes on resize.
 */
import { createContext, type RefObject, useContext, useLayoutEffect, useState } from "react";
import {
  DROP_ORDER,
  middleTruncate,
  type StatusDrop,
  statusDrops,
  statusFit,
  type StatusFit,
} from "./statusFit.ts";

export const FIT_BRANCH = "branch";

export const FIT_COMPLETIONS = "completions";

export const FIT_SPACER = "spacer";

export const FIT_HOST = "host";

/** An item CSS truncates once the fit has nothing left to give: the change count, the cursor. */
export const FIT_YIELDS = "yields";

/** Whether Completions shows its label; the status row's fit decides. */
export const CompletionsFit = createContext<StatusFit["completions"]>("label");

export const useCompletionsFit = () => useContext(CompletionsFit);

/** The items the status row's fit dropped; each marks itself with `data-drop` and hides. */
export const StatusDrops = createContext<ReadonlyArray<StatusDrop>>([]);

export const useDropped = (item: StatusDrop) => useContext(StatusDrops).includes(item);

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
  /** The Host name's width cap in px; null shows it whole. */
  readonly host: number | null;
  readonly drops: ReadonlyArray<StatusDrop>;
}

const NONE: ReadonlyArray<StatusDrop> = [];

/**
 * Each droppable item's width with its gap: measured while shown, and kept on the element while
 * hidden, so a dropped item still counts for whether it can come back.
 */
const dropWidths = (row: HTMLElement): Record<StatusDrop, number> => {
  const widths: Record<StatusDrop, number> = { indent: 0, "sync-counts": 0, latency: 0 };

  for (const item of DROP_ORDER) {
    const element = row.querySelector<HTMLElement>(`[data-drop="${item}"]`);

    if (element === null) continue;

    if (!element.hidden) {
      const gap = Number.parseFloat(getComputedStyle(element.parentElement ?? row).columnGap) || 0;
      const margin = Number.parseFloat(getComputedStyle(element).marginLeft) || 0;

      element.dataset.dropWidth = String(element.offsetWidth + gap + margin);
    }

    widths[item] = Number(element.dataset.dropWidth ?? 0);
  }

  return widths;
};

/** What CSS can still take from the items that truncate: their whole text. */
const yielded = (row: HTMLElement) =>
  [...row.querySelectorAll<HTMLElement>(`[data-fit="${FIT_YIELDS}"]`)].reduce(
    (sum, y) => sum + y.scrollWidth,
    0
  );

/** An item's width with everything in it that CSS truncated or the row squeezed given back. */
const natural = (item: HTMLElement) => {
  if (item.dataset.fit === FIT_YIELDS) return item.scrollWidth;
  const yields = [...item.querySelectorAll<HTMLElement>(`[data-fit="${FIT_YIELDS}"]`)];

  return yields.reduce(
    (width, y) => width + y.scrollWidth - y.offsetWidth,
    Math.max(item.offsetWidth, item.scrollWidth)
  );
};

/** The row's width left for the branch's text once every other item has its natural width. */
const roomFor = (
  row: HTMLElement,
  slot: HTMLElement,
  host: HTMLElement | null,
  hostWidth: number
) => {
  const group = slot.parentElement;
  const style = getComputedStyle(row);
  const gap = Number.parseFloat(style.columnGap) || 0;
  const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
  const items = [...row.children].filter((child) => child instanceof HTMLElement);
  let taken = padding + gap * Math.max(0, items.length - 1);

  for (const item of items) {
    if (item.dataset.fit === FIT_SPACER) continue;

    // The branch's icon and counts keep their width; only its text gives way. The Host counts whole.
    if (item === group) taken += item.offsetWidth - slot.offsetWidth;
    else if (host !== null && item.contains(host))
      taken += item.offsetWidth - host.offsetWidth + hostWidth;
    else taken += natural(item);
  }

  return row.clientWidth - taken;
};

const measure = (row: HTMLElement, branch: string | null, shown: Shown): Shown => {
  const slot = part(row, FIT_BRANCH);
  const completions = part(row, FIT_COMPLETIONS);
  const host = part(row, FIT_HOST);
  const label = completions?.dataset.fitLabel ?? "";
  const labelWidth = completions === null ? 0 : textWidth(completions, label);
  const hostWidth = host === null ? 0 : textWidth(host, host.textContent ?? "");

  if (branch === null || slot === null)
    return { completions: "label", branch: null, host: null, drops: NONE };
  const widths = dropWidths(row);
  const dropped = shown.drops.reduce((sum, item) => sum + widths[item], 0);

  // While Completions shows its glyph or items are dropped, their widths are what the row gave back.
  const room =
    roomFor(row, slot, host, hostWidth) -
    (shown.completions === "glyph" ? labelWidth : 0) -
    dropped;

  const fit = statusFit({
    room,
    branch: textWidth(slot, branch),
    completionsLabel: labelWidth,
    host: hostWidth,
  });

  const drops = statusDrops(fit.short - yielded(row), widths);

  return {
    completions: fit.completions,
    drops: drops.join() === shown.drops.join() ? shown.drops : drops,
    host: fit.hostRoom === null ? null : Math.floor(fit.hostRoom),
    branch:
      fit.branchRoom === null
        ? branch
        : middleTruncate(branch, fit.branchRoom, (text) => textWidth(slot, text)),
  };
};

export const useStatusFit = (
  row: RefObject<HTMLElement | null>,
  branch: string | null,
  host: string
): Shown => {
  const [shown, setShown] = useState<Shown>({
    completions: "label",
    branch,
    host: null,
    drops: NONE,
  });

  useLayoutEffect(() => {
    const element = row.current;

    if (element === null) return;

    const update = () =>
      setShown((current) => {
        const next = measure(element, branch, current);

        return next.completions === current.completions &&
          next.branch === current.branch &&
          next.host === current.host &&
          next.drops === current.drops
          ? current
          : next;
      });

    update();
    const observer = new ResizeObserver(update);

    observer.observe(element);

    for (const child of element.children) observer.observe(child);

    // A squeezed item's text can change without its box resizing: re-fit once per frame on edits.
    let frame: number | null = null;

    const edits = new MutationObserver(() => {
      frame ??= requestAnimationFrame(() => {
        frame = null;
        update();
      });
    });

    edits.observe(element, { subtree: true, childList: true, characterData: true });

    return () => {
      observer.disconnect();
      edits.disconnect();

      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [row, branch, host]);

  return shown;
};
