import "../../../../test/dom.testing.ts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { fixturePage, resetLogbook } from "../../preview/logbook.ts";
import type { EntryData } from "../../model/logbook.ts";
import { Feed } from "./Feed.tsx";

const SIZES = { offsetWidth: 720, offsetHeight: 640 } as const;

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

const mount = (entries: ReadonlyArray<EntryData>, selected: string | null = null) =>
  render(
    <Feed
      entries={entries}
      tasks={new Map()}
      selected={selected}
      now={Date.now()}
      onSelect={() => undefined}
      onOpen={() => undefined}
    />
  );

test("a feed of 5,000 entries mounts only the lines in view", () => {
  mount(many(5000));

  const lines = screen.getAllByRole("option");

  expect(lines.length).toBeGreaterThan(10);
  expect(lines.length).toBeLessThan(80);
});

test("↵ on a line opens its Task", () => {
  const opened: Array<string> = [];
  const entries = many(40);

  render(
    <Feed
      entries={entries}
      tasks={new Map()}
      selected={null}
      now={Date.now()}
      onSelect={() => undefined}
      onOpen={(taskId) => opened.push(taskId)}
    />
  );
  fireEvent.keyDown(screen.getAllByRole("option")[0] ?? document.body, { key: "Enter" });

  expect(opened).toEqual([entries[0]?.taskId ?? "missing"]);
});
