/**
 * Following the end of the conversation: pinned while the user is at the end, released the
 * moment they scroll up (wheel, keys, the scrollbar or a selection drag), pinned again when
 * they come back down. Only the user's own scrolling releases: content growing, shrinking or
 * a page landing above never does. Listeners are passive and do no React work per frame.
 */

/** Within this distance of the end, scrolling down pins again. */
export const PIN_PX = 16;

const UP_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);

const DOWN_KEYS = new Set(["ArrowDown", "PageDown", "End"]);

export interface FollowTarget {
  readonly pinned: () => boolean;
  /** Called on a change only, never per frame. */
  readonly setPinned: (pinned: boolean) => void;
  /** The viewport changed size while pinned: put the end back in view. */
  readonly keepEnd: () => void;
}

const maxTop = (list: HTMLElement) => Math.max(0, list.scrollHeight - list.clientHeight);

const nearEnd = (list: HTMLElement) => maxTop(list) - list.scrollTop <= PIN_PX;

const isField = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Which way a key scrolls the list, if it does. */
const keyDirection = (event: KeyboardEvent): "up" | "down" | null => {
  if (UP_KEYS.has(event.key) || (event.key === " " && event.shiftKey)) return "up";

  if (DOWN_KEYS.has(event.key) || event.key === " ") return "down";

  return null;
};

/**
 * Watches `list` (the scroll element) and `host` (around it and its overlay scrollbar, so a
 * wheel or drag there counts). Returns the cleanup.
 */
export const watchFollow = (list: HTMLElement, host: HTMLElement, target: FollowTarget) => {
  let lastTop = list.scrollTop;
  let lastMax = maxTop(list);
  // A pointer is held: a scrollbar drag or a selection drag is the user's scrolling.
  let held = false;

  const set = (pinned: boolean) => {
    if (pinned !== target.pinned()) target.setPinned(pinned);
  };

  const toward = (direction: "up" | "down") => {
    if (direction === "up" && list.scrollTop > 0) set(false);
    else if (direction === "down" && nearEnd(list)) set(true);
  };

  const onWheel = (event: WheelEvent) => {
    if (event.deltaY !== 0) toward(event.deltaY < 0 ? "up" : "down");
  };

  const onKey = (event: KeyboardEvent) => {
    const direction = isField(event.target) ? null : keyDirection(event);

    if (direction !== null) toward(direction);
  };

  const onScroll = () => {
    const top = list.scrollTop;
    const max = maxTop(list);
    // Content shrinking clamps the offset down too; that isn't the user leaving the end.
    const userUp = held && top < lastTop - 0.5 && max >= lastMax - 0.5;

    if (userUp) set(false);
    else if (top > lastTop && max - top <= PIN_PX) set(true);
    lastTop = top;
    lastMax = max;
  };

  const press = () => {
    held = true;
  };

  const lift = () => {
    held = false;
  };

  const resize = new ResizeObserver(() => {
    if (target.pinned() && !nearEnd(list)) target.keepEnd();
    lastMax = maxTop(list);
  });

  resize.observe(list);
  const passive = { passive: true } as const;

  host.addEventListener("wheel", onWheel, passive);
  host.addEventListener("keydown", onKey);
  host.addEventListener("pointerdown", press, passive);
  window.addEventListener("pointerup", lift, passive);
  window.addEventListener("pointercancel", lift, passive);
  list.addEventListener("scroll", onScroll, passive);

  return () => {
    resize.disconnect();
    host.removeEventListener("wheel", onWheel);
    host.removeEventListener("keydown", onKey);
    host.removeEventListener("pointerdown", press);
    window.removeEventListener("pointerup", lift);
    window.removeEventListener("pointercancel", lift);
    list.removeEventListener("scroll", onScroll);
  };
};

/** Lets the Transcript's command reach the list: jump to the end, while there is one to jump to. */
export interface JumpControl {
  readonly run: () => void;
  readonly available: () => boolean;
  readonly bind: (handlers: {
    readonly run: () => void;
    readonly available: () => boolean;
  }) => () => void;
}

export const createJumpControl = (): JumpControl => {
  let bound: { readonly run: () => void; readonly available: () => boolean } | null = null;

  return {
    run: () => bound?.run(),
    available: () => bound?.available() ?? false,
    bind: (handlers) => {
      bound = handlers;

      return () => {
        if (bound === handlers) bound = null;
      };
    },
  };
};

/** Rows other than the "older" one: a page landing above adds it without anything new below. */
const listed = (rows: ReadonlyArray<{ readonly key: string }>) =>
  rows.length - (rows[0]?.key === "older" ? 1 : 0);

export interface Tail {
  readonly lastKey: string | null;
  readonly count: number;
  readonly firstTurnId: string | null;
}

export const tailOf = (
  rows: ReadonlyArray<{ readonly key: string }>,
  firstTurnId: string | null
): Tail => ({ lastKey: rows.at(-1)?.key ?? null, count: listed(rows), firstTurnId });

/** Something new arrived below: a new last row, or more rows without older Turns landing above. */
export const arrivedBelow = (before: Tail, after: Tail) =>
  after.lastKey !== before.lastKey ||
  (after.count > before.count && after.firstTurnId === before.firstTurnId);
