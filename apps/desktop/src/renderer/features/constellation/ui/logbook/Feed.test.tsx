import "../../../../test/dom.testing.ts";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { fixturePage, resetLogbook } from "../../preview/logbook.ts";
import type { EntryData } from "../../model/logbook.ts";
import { Feed, useFeedCursor } from "./Feed.tsx";

const SIZES = {
  offsetWidth: 720,
  offsetHeight: 640,
  clientHeight: 640,
  scrollHeight: 26 * 5000,
} as const;

const originals = Object.keys(SIZES).map(
  (key) => [key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)] as const
);

// happy-dom has no layout: give every element the pane the virtualizer measures.
beforeAll(() => {
  for (const [key, size] of Object.entries(SIZES))
    Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => size });
});

afterAll(() => {
  for (const [key, descriptor] of originals)
    if (descriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, key);
    else Object.defineProperty(HTMLElement.prototype, key, descriptor);
});

afterEach(cleanup);

const NOW = Date.now();

/** The fixture's entries repeated to `count`, each with its own id, newest first. */
const many = (count: number): ReadonlyArray<EntryData> => {
  resetLogbook();
  const base = fixturePage(null).entries;

  return Array.from({ length: count }, (_, n) => {
    const entry = base[n % base.length];

    if (entry === undefined) throw new Error("the fixture has entries");

    return { ...entry, id: `${count - n}:${entry.taskId}`, sequence: entry.sequence };
  });
};

/** The feed as the tab drives it: ↑↓ move the cursor, ↵ opens the cursor's Task. */
const Harness = ({
  entries,
  onOpen,
  inTask = false,
}: {
  readonly entries: ReadonlyArray<EntryData>;
  readonly onOpen: (taskId: string) => void;
  /** The tab shows a Task's Logbook instead of the feed, keeping its cursor. */
  readonly inTask?: boolean;
}) => {
  const { cursor, move, select } = useFeedCursor(entries);

  const ref = useRef<HTMLElement>(null);

  // The tab listens on its section, as LogbookTab does.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp")
        move(event.key === "ArrowDown" ? 1 : -1);
      const entry = entries.find((e) => e.id === cursor.id);

      if (event.key === "Enter" && entry !== undefined) onOpen(entry.taskId);
    };

    const el = ref.current;

    el?.addEventListener("keydown", onKeyDown);

    return () => el?.removeEventListener("keydown", onKeyDown);
  });

  return (
    <section aria-label="logbook" tabIndex={-1} ref={ref}>
      {inTask ? null : (
        <Feed
          entries={entries}
          tasks={new Map()}
          cursor={cursor}
          now={NOW}
          onSelect={select}
          onOpen={onOpen}
        />
      )}
    </section>
  );
};

const mount = (entries: ReadonlyArray<EntryData>, onOpen: (taskId: string) => void = () => {}) =>
  render(<Harness entries={entries} onOpen={onOpen} />);

/** Keys on the tab; happy-dom doesn't fire `scroll` when the list scrolls itself, so this does. */
const press = (key: string, times = 1) => {
  for (let n = 0; n < times; n += 1) {
    fireEvent.keyDown(screen.getByLabelText("logbook"), { key });
    fireEvent.scroll(screen.getByTestId("logbook-feed"));
  }
};

/** The first line fully in view, from the list's scroll offset (lines are a fixed height). */
const topLine = (list: HTMLElement, entries: ReadonlyArray<EntryData>) =>
  entries[Math.ceil((list.scrollTop - 6) / 26)]?.id;

test("a feed of 5,000 entries mounts only the lines in view", () => {
  mount(many(5000));

  const lines = screen.getAllByRole("option");

  expect(lines.length).toBeGreaterThan(10);
  expect(lines.length).toBeLessThan(80);
});

test("a live entry arriving while the user reads further down keeps their place", () => {
  const entries = many(300);
  const { rerender } = render(<Harness entries={entries.slice(3)} onOpen={() => {}} />);
  const list = screen.getByTestId("logbook-feed");

  press("ArrowDown");
  act(() => {
    list.scrollTop = 26 * 120 + 6;
    fireEvent.scroll(list);
  });
  const reading = topLine(list, entries.slice(3));

  rerender(<Harness entries={entries} onOpen={() => {}} />);

  expect(topLine(list, entries)).toBe(reading);
});

test("a live entry arriving at the top of the feed shows there", () => {
  const entries = many(300);
  const { rerender } = render(<Harness entries={entries.slice(3)} onOpen={() => {}} />);
  const list = screen.getByTestId("logbook-feed");

  rerender(<Harness entries={entries} onOpen={() => {}} />);

  expect(list.scrollTop).toBe(0);
});

test("↓ to a line below the view brings it into view, and ↵ opens its Task", () => {
  const entries = many(300);
  const opened: Array<string> = [];

  mount(entries, (taskId) => opened.push(taskId));
  const list = screen.getByTestId("logbook-feed");

  press("ArrowDown", 60);
  const top = 6 + 59 * 26;

  expect(list.scrollTop).toBeLessThanOrEqual(top);
  expect(list.scrollTop + 640).toBeGreaterThanOrEqual(top + 26);
  expect(screen.getByRole("option", { selected: true }).dataset.entry).toBe(entries[59]?.id);

  press("Enter");

  expect(opened).toEqual([entries[59]?.taskId ?? "missing"]);
});

test("back from a Task, the feed shows the line the user clicked where they left it", () => {
  const entries = many(300);
  const { rerender } = render(<Harness entries={entries} onOpen={() => {}} />);
  const scrolled = 6 + 120 * 26;

  act(() => {
    const list = screen.getByTestId("logbook-feed");

    list.scrollTop = scrolled;
    fireEvent.scroll(list);
  });
  const clicked = entries[125]?.id ?? "missing";

  fireEvent.click(
    screen.getAllByRole("option").find((o) => o.dataset.entry === clicked) ?? document.body
  );
  rerender(<Harness entries={entries} onOpen={() => {}} inTask />);
  rerender(<Harness entries={entries} onOpen={() => {}} />);
  const list = screen.getByTestId("logbook-feed");

  fireEvent.scroll(list);

  expect(list.scrollTop).toBeLessThanOrEqual(6 + 125 * 26);
  expect(list.scrollTop + 640).toBeGreaterThanOrEqual(6 + 126 * 26);
  expect(screen.getByRole("option", { selected: true }).dataset.entry).toBe(clicked);
});
