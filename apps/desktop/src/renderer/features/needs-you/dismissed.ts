/**
 * What this Mac dismissed from Needs You (N1), kept in `localStorage` so it survives a
 * restart. Never sent to a Host: another Mac still shows the item.
 */
import { Option, Schema } from "effect";
import { type Dismissed, type Dismissible, stampOf } from "./model/dismissed.ts";

const KEY = "polaris.needsYou.dismissed";

const listeners = new Set<() => void>();

const decode = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String))
);

const read = (): Dismissed => {
  try {
    return new Map(
      Object.entries(Option.getOrElse(decode(localStorage.getItem(KEY) ?? "{}"), () => ({})))
    );
  } catch {
    return new Map();
  }
};

let snapshot: Dismissed = read();

const write = (next: Dismissed) => {
  snapshot = next;

  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(next)));
  } catch {
    // Storage can be unavailable; the dismissal still holds for this run.
  }

  for (const listener of listeners) listener();
};

const same = (a: Dismissed, b: Dismissed) =>
  a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

export const dismissed = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  },
  get: (): Dismissed => snapshot,
};

/** Hides these items on this Mac until their sessions change. */
export const dismiss = (items: ReadonlyArray<Dismissible>) =>
  write(new Map([...snapshot, ...items.map((i) => [i.key, stampOf(i)] as const)]));

/** "Show": brings every dismissed item back. */
export const restoreDismissed = () => write(new Map());

/** Forgets dismissals whose item came back or went away, so the store stays small. */
export const pruneDismissed = (current: Dismissed) => {
  if (!same(current, snapshot)) write(current);
};
