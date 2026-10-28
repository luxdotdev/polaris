/**
 * What React Native's host adds over the bare `hermes` VM and the self-check needs: `console`,
 * and timers that honour their delay. Nothing else: the runtime needs no polyfill on Hermes.
 */
declare const print: (...values: ReadonlyArray<unknown>) => void;

if (typeof globalThis.console === "undefined") {
  const log = (...values: ReadonlyArray<unknown>) => print(...values);

  Reflect.set(globalThis, "console", { log, info: log, warn: log, error: log, debug: log });
}

// The CLI's setTimeout ignores the delay and runs callbacks in the order they were set, so a
// 5 s timeout set first fires before a 1 ms sleep. Timers here run in due order, on virtual time.
const tick = globalThis.setTimeout;

const timers: Array<{ id: number; due: number; run: () => void }> = [];

let now = 0;

let nextId = 1;

const pump = () => {
  timers.sort((a, b) => a.due - b.due || a.id - b.id);
  const timer = timers.shift();

  if (timer === undefined) return;
  now = Math.max(now, timer.due);
  timer.run();
};

const setTimer = (run: () => void, delay = 0): number => {
  const id = nextId++;

  timers.push({ id, due: now + Math.max(0, delay), run });
  tick(pump, 0);

  return id;
};

const clearTimer = (id: number | undefined) => {
  const at = timers.findIndex((timer) => timer.id === id);

  if (at >= 0) timers.splice(at, 1);
};

Reflect.set(globalThis, "setTimeout", setTimer);

Reflect.set(globalThis, "clearTimeout", clearTimer);
