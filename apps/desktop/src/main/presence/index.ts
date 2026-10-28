/**
 * Whether the user is at this computer (ENG-495), from Electron's `powerMonitor`: present
 * while input is recent; away after `AWAY_AFTER_S` idle, or at once on a lock, screensaver,
 * sleep or user switch. Only present or away leaves the Mac, never idle times.
 */
import type { UserPresence } from "@polaris/protocol";

/** Idle this long and the user is away. */
export const AWAY_AFTER_S = 180;

/** How often the idle state is read: how soon a return to the keyboard counts. */
export const PRESENCE_POLL_MS = 15_000;

export type IdleState = "active" | "idle" | "locked" | "unknown";

/** Events that say at once the user left (`away`) or may be back (`back`). */
const AWAY_EVENTS = ["lock-screen", "suspend", "user-did-resign-active"] as const;

const BACK_EVENTS = ["unlock-screen", "resume", "user-did-become-active"] as const;

export type PresenceEvent = (typeof AWAY_EVENTS)[number] | (typeof BACK_EVENTS)[number];

/** The part of Electron's `powerMonitor` presence reads; methods, so its per-event overloads fit. */
export interface PresenceMonitor {
  getSystemIdleState(idleThreshold: number): IdleState;
  on(event: PresenceEvent, listener: () => void): void;
  removeListener(event: PresenceEvent, listener: () => void): void;
}

/** `locked` covers the screensaver too; an unknown state reads as away, so pushes go out. */
export const presenceOf = (idle: IdleState, left: boolean): UserPresence =>
  !left && idle === "active" ? "present" : "away";

export interface PresenceWatch {
  readonly current: () => UserPresence;
  /** Reads the state again now, e.g. once the setting changes. */
  readonly check: () => void;
  readonly dispose: () => void;
}

export const watchPresence = (input: {
  readonly monitor: PresenceMonitor;
  /** Settings → Sessions, "Quiet my phone while I'm at this computer": off reads as away. */
  readonly enabled: () => boolean;
  readonly onChange: (presence: UserPresence) => void;
  readonly pollMs?: number;
}): PresenceWatch => {
  let left = false;
  let current: UserPresence = "away";

  const check = () => {
    const next = input.enabled()
      ? presenceOf(input.monitor.getSystemIdleState(AWAY_AFTER_S), left)
      : "away";

    if (next === current) return;
    current = next;
    input.onChange(next);
  };

  const away = () => {
    left = true;
    check();
  };

  const back = () => {
    left = false;
    check();
  };

  for (const event of AWAY_EVENTS) input.monitor.on(event, away);

  for (const event of BACK_EVENTS) input.monitor.on(event, back);
  const timer = setInterval(check, input.pollMs ?? PRESENCE_POLL_MS);
  check();

  return {
    current: () => current,
    check,
    dispose: () => {
      clearInterval(timer);

      for (const event of AWAY_EVENTS) input.monitor.removeListener(event, away);

      for (const event of BACK_EVENTS) input.monitor.removeListener(event, back);
    },
  };
};
