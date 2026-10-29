import "../../../test/dom.testing.ts";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { SessionId } from "@polaris/protocol";
import { TooltipProvider } from "@polaris/ui";
import type { Row } from "../model/conversation.ts";
import { Conversation } from "./Conversation.tsx";
import type { RowContext } from "./rows.tsx";

// happy-dom has no layout, so it is faked: rows as tall as `heights`, a 400px list whose offset
// clamps and fires `scroll` after a write, and resizes through a fake ResizeObserver.
const VIEW = 400;

const heights = new Map<string, number>();

const observers = new Map<Element, Set<ResizeObserverCallback>>();

const tops = new WeakMap<Element, number>();

const restores: Array<() => void> = [];

const isList = (el: Element) => el instanceof HTMLElement && el.dataset.testid === "conversation";

const contentHeight = (el: Element) =>
  el.firstElementChild instanceof HTMLElement
    ? Number.parseFloat(el.firstElementChild.style.height) || 0
    : 0;

const maxTop = (el: Element) => Math.max(0, contentHeight(el) - VIEW);

const writeTop = (el: Element, value: number) => {
  const next = Math.min(Math.max(0, value), maxTop(el));

  if (next === (tops.get(el) ?? 0)) return;
  tops.set(el, next);
  queueMicrotask(() => el.dispatchEvent(new Event("scroll")));
};

/** Overrides `name` on `target` until the test ends. */
const fake = (
  target: HTMLElement | Window | typeof globalThis,
  name: string,
  descriptor: PropertyDescriptor
) => {
  const own = Object.getOwnPropertyDescriptor(target, name);

  Object.defineProperty(target, name, { configurable: true, ...descriptor });
  restores.push(() => {
    if (own === undefined) Reflect.deleteProperty(target, name);
    else Object.defineProperty(target, name, own);
  });
};

class FakeResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(el: Element) {
    observers.set(el, (observers.get(el) ?? new Set()).add(this.callback));
  }
  unobserve(el: Element) {
    observers.get(el)?.delete(this.callback);
  }
  disconnect() {
    for (const set of observers.values()) set.delete(this.callback);
  }
}

/** A size only the list has; every other element reads 0. */
const listOnly = (size: number) => ({
  get(this: Element) {
    return isList(this) ? size : 0;
  },
});

beforeEach(() => {
  fake(HTMLElement.prototype, "scrollTop", {
    get(this: Element) {
      return isList(this) ? (tops.get(this) ?? 0) : 0;
    },
    set(this: Element, value: number) {
      if (isList(this)) writeTop(this, value);
    },
  });
  fake(HTMLElement.prototype, "scrollHeight", {
    get(this: Element) {
      return isList(this) ? Math.max(VIEW, contentHeight(this)) : 0;
    },
  });
  fake(HTMLElement.prototype, "clientHeight", listOnly(VIEW));
  fake(HTMLElement.prototype, "offsetWidth", listOnly(600));
  fake(HTMLElement.prototype, "offsetHeight", {
    get(this: HTMLElement) {
      return isList(this) ? VIEW : (heights.get(this.dataset.rowKey ?? "") ?? 0);
    },
  });
  fake(HTMLElement.prototype, "scrollTo", {
    value(this: Element, options: ScrollToOptions) {
      if (isList(this)) writeTop(this, options.top ?? 0);
    },
  });

  for (const target of [globalThis, document.defaultView]) {
    if (target !== null) fake(target, "ResizeObserver", { value: FakeResizeObserver });
  }

  // The Markdown preload waits for idle time, which happy-dom doesn't have.
  fake(globalThis, "requestIdleCallback", { value: () => 0 });
});

afterEach(() => {
  cleanup();

  for (const restore of restores.splice(0).reverse()) restore();
  heights.clear();
  observers.clear();
});

/** Lets the faked scroll events, effects and the virtualizer's frames run. */
const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
};

const rowsOf = (keys: ReadonlyArray<string>): ReadonlyArray<Row> =>
  keys.map((key) => ({ kind: "trailer", key }));

const keys = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, n) => `r${from + n}`);

const none = () => {};

const ctx: RowContext = {
  harness: null,
  celestial: "sun",
  state: "idle",
  liveTurnId: null,
  where: "local",
  onSetTurnOpen: none,
  onOpenDiff: none,
  onRespond: none,
  onContinue: none,
  limit: null,
  onLoadOlder: none,
  onRetry: none,
  modelLabel: () => "",
  canSteer: false,
  outbox: { retry: none, edit: none },
  diff: { hostKey: "local", cwd: "/repo", sessionId: SessionId.make("s1") },
  chrome: { trailer: <p>row</p> },
  latestDoneTurnId: null,
  onCopyTurn: none,
  onForkTurn: null,
  onOpenSubagent: none,
};

let mounted = 0;

const mount = async (rowKeys: ReadonlyArray<string>, firstTurnId: string | null = "t1") => {
  for (const key of rowKeys) heights.set(key, 100);

  const scrollKey = `session-${++mounted}`;

  const view = (next: ReadonlyArray<string>, first: string | null) => (
    <TooltipProvider>
      <div className="relative">
        <Conversation scrollKey={scrollKey} rows={rowsOf(next)} ctx={ctx} firstTurnId={first} />
      </div>
    </TooltipProvider>
  );

  const utils = render(view(rowKeys, firstTurnId));

  await settle();
  const list = utils.getByTestId("conversation");
  const arrow = utils.getByTestId("jump-to-latest");

  return {
    list,
    arrow,
    distance: () => maxTop(list) - list.scrollTop,
    rerender: async (next: ReadonlyArray<string>, first: string | null = firstTurnId) => {
      for (const key of next) if (!heights.has(key)) heights.set(key, 100);
      utils.rerender(view(next, first));
      await settle();
    },
  };
};

/** The row grows to `height`, as the browser's ResizeObserver would report it. */
const grow = async (key: string, height: number) => {
  heights.set(key, height);
  const el = document.querySelector(`[data-row-key="${key}"]`);

  if (el === null) throw new Error(`row ${key} isn't rendered`);

  for (const callback of observers.get(el) ?? []) {
    const box = [{ blockSize: height, inlineSize: 600 }];

    const entry: ResizeObserverEntry = {
      target: el,
      borderBoxSize: box,
      contentBoxSize: box,
      devicePixelContentBoxSize: box,
      contentRect: new DOMRect(0, 0, 600, height),
    };

    await act(async () => callback([entry], new FakeResizeObserver(callback)));
  }

  await settle();
};

/** The user wheels up by `delta`: the wheel event, then the offset it scrolls to. */
const wheelUp = async (list: HTMLElement, delta: number) => {
  fireEvent.wheel(list, { deltaY: -delta });
  list.scrollTop -= delta;
  await settle();
};

test("opens at the end, pinned, with no arrow", async () => {
  const { distance, arrow } = await mount(keys(0, 20));

  expect(distance()).toBe(0);
  expect(arrow.dataset.shown).toBe("false");
});

test("while pinned, the last row growing and new rows keep the end in view", async () => {
  const { distance, rerender, arrow } = await mount(keys(0, 20));

  await grow("r19", 260);
  expect(distance()).toBe(0);

  await rerender(keys(0, 22));
  expect(distance()).toBe(0);
  expect(arrow.dataset.shown).toBe("false");
});

test("scrolling up releases: growth below doesn't move the list, and the arrow shows", async () => {
  const { list, arrow, rerender } = await mount(keys(0, 20));

  await wheelUp(list, 300);
  const top = list.scrollTop;

  expect(arrow.dataset.shown).toBe("true");
  expect(arrow.querySelector("[data-testid=jump-fresh]")).toBeNull();

  await grow("r19", 400);
  await rerender(keys(0, 23));

  expect(list.scrollTop).toBe(top);
  expect(arrow.querySelector("[data-testid=jump-fresh]")).not.toBeNull();
});

test("even a small scroll up, inside any end threshold, releases", async () => {
  const { list, arrow } = await mount(keys(0, 20));

  await wheelUp(list, 8);
  const top = list.scrollTop;

  await grow("r19", 300);

  expect(list.scrollTop).toBe(top);
  expect(arrow.dataset.shown).toBe("true");
});

test("the arrow jumps to the end and pins again, so growth follows", async () => {
  const { list, arrow, distance } = await mount(keys(0, 20));

  await wheelUp(list, 500);
  fireEvent.click(arrow);
  await settle();

  expect(distance()).toBe(0);
  expect(arrow.dataset.shown).toBe("false");

  await grow("r19", 300);
  expect(distance()).toBe(0);
});

test("scrolling back down to the end pins again", async () => {
  const { list, arrow, distance } = await mount(keys(0, 20));

  await wheelUp(list, 200);
  fireEvent.wheel(list, { deltaY: 200 });
  list.scrollTop += 200;
  await settle();

  expect(arrow.dataset.shown).toBe("false");
  await grow("r19", 300);
  expect(distance()).toBe(0);
});

test("older Turns landing above keep the row the user is reading in place", async () => {
  const { list, rerender } = await mount(["older", ...keys(0, 20)], "t1");

  await wheelUp(list, 900);
  const reading = document.querySelector<HTMLElement>('[data-row-key="r8"]');

  const offsetOf = () => {
    const at = /translate3d\(0(?:px)?, ([\d.]+)px/.exec(reading?.style.transform ?? "");

    return Number.parseFloat(at?.[1] ?? "NaN") - list.scrollTop;
  };

  const before = offsetOf();

  expect(before).not.toBeNaN();

  await rerender(["older", ...keys(-5, 0), ...keys(0, 20)], "t0");

  expect(offsetOf()).toBe(before);
  // Nothing arrived below, so the arrow isn't marked.
  expect(document.querySelector("[data-testid=jump-fresh]")).toBeNull();
});
