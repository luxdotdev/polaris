/**
 * Puts pages on the glasses at most once per `delayMs` (the BLE queue is
 * slow): the latest page wins, text-only changes update in place, and a
 * changed layout rebuilds the page.
 */
import { layoutKey, type Page, type TextBox } from "../model/page.ts";

export interface Surface {
  /** The first page; the glasses take it once. */
  readonly create: (page: Page) => Promise<boolean>;
  readonly rebuild: (page: Page) => Promise<boolean>;
  readonly upgrade: (text: TextBox) => Promise<boolean>;
}

export const RENDER_DELAY_MS = 120;

export interface Renderer {
  readonly show: (page: Page) => void;
  /** Resolves once every page shown so far is on the glasses. */
  readonly settled: () => Promise<void>;
}

/** `report` hears each page the glasses refused or failed to take. */
export const rendererFor = (
  surface: Surface,
  delayMs = RENDER_DELAY_MS,
  report: (line: string) => void = () => undefined
): Renderer => {
  let current: Page | null = null;
  let latest: Page | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let drawing: Promise<void> = Promise.resolve();

  const draw = async (page: Page) => {
    if (current === null) {
      if (await surface.create(page)) current = page;
      else report("the glasses refused the first page");

      return;
    }

    const before = current;

    if (layoutKey(before) !== layoutKey(page)) {
      if (await surface.rebuild(page)) current = page;
      else report("the glasses refused a page");

      return;
    }

    const changed = page.texts.filter(
      (text) => before.texts.find((old) => old.id === text.id)?.content !== text.content
    );

    for (const text of changed) await surface.upgrade(text);
    current = page;
  };

  const flush = () => {
    timer = null;
    const page = latest;

    if (page === null) return;
    latest = null;
    drawing = drawing
      .then(() => draw(page))
      .catch((cause: unknown) => report(`drawing on the glasses failed: ${String(cause)}`));
  };

  return {
    show: (page) => {
      latest = page;
      timer ??= setTimeout(flush, delayMs);
    },
    settled: async () => {
      while (timer !== null || latest !== null) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      await drawing;
    },
  };
};
