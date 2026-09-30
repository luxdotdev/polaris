import { expect, test } from "bun:test";
import { type FeedCallbacks, RETRY_MAX_MS, retryingFeed, type Schedule } from "./retry.ts";

/** Timers the test runs by hand, recording each delay. */
const manualTimers = () => {
  const pending: Array<{ run: () => void; ms: number }> = [];

  const timers: Schedule = (run, ms) => {
    const entry = { run, ms };
    pending.push(entry);

    return () => {
      const at = pending.indexOf(entry);

      if (at !== -1) pending.splice(at, 1);
    };
  };

  return { timers, pending, fire: () => pending.shift()?.run() };
};

test("a failed feed reopens with growing delays, and starts over once it delivers", () => {
  const { timers, pending, fire } = manualTimers();
  const opened: Array<FeedCallbacks> = [];

  retryingFeed((callbacks) => {
    opened.push(callbacks);

    return () => {};
  }, timers);

  opened.at(-1)?.failed();
  expect(pending.map((p) => p.ms)).toEqual([1_000]);
  fire();
  opened.at(-1)?.failed();
  fire();
  opened.at(-1)?.failed();
  expect(pending.map((p) => p.ms)).toEqual([4_000]);
  fire();

  for (let i = 0; i < 10; i++) {
    opened.at(-1)?.failed();
    fire();
  }

  opened.at(-1)?.failed();
  expect(pending[0]?.ms).toBe(RETRY_MAX_MS);
  fire();
  opened.at(-1)?.delivered();
  opened.at(-1)?.failed();
  expect(pending.map((p) => p.ms)).toEqual([1_000]);
  expect(opened.length).toBeGreaterThan(10);
});

test("closing stops retries and closes the open feed", () => {
  const { timers, pending } = manualTimers();
  let closes = 0;
  let callbacks: FeedCallbacks | null = null;

  const close = retryingFeed((c) => {
    callbacks = c;

    return () => closes++;
  }, timers);

  callbacks!.failed();
  close();
  expect(pending).toEqual([]);
  expect(closes).toBe(1);
  callbacks!.failed();
  expect(pending).toEqual([]);
});
