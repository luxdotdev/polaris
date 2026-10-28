import { expect, test } from "bun:test";
import type { UserPresence } from "@polaris/protocol";
import {
  type IdleState,
  type PresenceEvent,
  type PresenceMonitor,
  watchPresence,
} from "./index.ts";

/** A `powerMonitor` whose idle state and events the test drives. */
const fakeMonitor = () => {
  let idle: IdleState = "active";
  const thresholds: Array<number> = [];
  const listeners = new Map<PresenceEvent, Set<() => void>>();

  const monitor: PresenceMonitor = {
    getSystemIdleState: (threshold) => {
      thresholds.push(threshold);

      return idle;
    },
    on: (event, listener) =>
      listeners.set(event, (listeners.get(event) ?? new Set()).add(listener)),
    removeListener: (event, listener) => listeners.get(event)?.delete(listener),
  };

  return {
    monitor,
    thresholds,
    setIdle: (next: IdleState) => (idle = next),
    emit: (event: PresenceEvent) => listeners.get(event)?.forEach((listener) => listener()),
    listening: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
};

const watch = (fake: ReturnType<typeof fakeMonitor>, enabled = () => true) => {
  const changes: Array<UserPresence> = [];

  const presence = watchPresence({
    monitor: fake.monitor,
    enabled,
    onChange: (next) => changes.push(next),
    pollMs: 60_000,
  });

  return { presence, changes };
};

test("present while input is recent, away once idle past three minutes, present on return", () => {
  const fake = fakeMonitor();
  const { presence, changes } = watch(fake);

  // Three minutes, as the issue agreed.
  expect(new Set(fake.thresholds)).toEqual(new Set([180]));
  fake.setIdle("idle");
  presence.check();
  fake.setIdle("active");
  presence.check();
  presence.dispose();

  expect(changes).toEqual(["present", "away", "present"]);
});

test("a lock is away at once, before any idle time; unlocking is present again", () => {
  const fake = fakeMonitor();
  const { presence, changes } = watch(fake);

  fake.emit("lock-screen");
  expect(presence.current()).toBe("away");
  // The idle state still says active right after the lock: the event alone decides.
  presence.check();
  expect(presence.current()).toBe("away");
  fake.emit("unlock-screen");
  presence.dispose();

  expect(changes).toEqual(["present", "away", "present"]);
});

test.each<[string, "locked" | "unknown" | PresenceEvent]>([
  ["the screensaver (the idle state reads locked)", "locked"],
  ["an unknown idle state", "unknown"],
  ["sleep", "suspend"],
  ["switching to another macOS user", "user-did-resign-active"],
])("%s is away", (_, cause) => {
  const fake = fakeMonitor();
  const { presence } = watch(fake);

  if (cause === "locked" || cause === "unknown") {
    fake.setIdle(cause);
    presence.check();
  } else fake.emit(cause);

  expect(presence.current()).toBe("away");
  presence.dispose();
});

test("with the setting off nothing reads as present, and turning it off ends presence", () => {
  const fake = fakeMonitor();
  let on = false;
  const { presence, changes } = watch(fake, () => on);

  expect(changes).toEqual([]);
  on = true;
  presence.check();
  on = false;
  presence.check();
  presence.dispose();

  expect(changes).toEqual(["present", "away"]);
  expect(fake.listening()).toBe(0);
});
