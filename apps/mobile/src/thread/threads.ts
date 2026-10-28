/**
 * Open threads by Host and session, outside any screen: a screen leases one,
 * and a reconnect or leaving the screen keeps it, its transcript and its
 * queued follow-ups. It closes once no screen holds it and nothing is pending.
 */
import type { ThreadController } from "./controller.ts";

export interface ThreadLease {
  readonly controller: ThreadController;
  /** The screen let go; calling it again does nothing. */
  readonly release: () => void;
}

interface Held {
  readonly controller: ThreadController;
  leases: number;
  readonly stop: () => void;
}

export interface ThreadRegistry {
  /** The thread held for this key, else a new one from `open`; null when neither. */
  readonly acquire: (key: string, open: (() => ThreadController) | null) => ThreadLease | null;
}

export const threadKey = (hostId: string, sessionId: string) => `${hostId}\u0000${sessionId}`;

export const makeThreadRegistry = (): ThreadRegistry => {
  const threads = new Map<string, Held>();

  const closeIfIdle = (key: string) => {
    const held = threads.get(key);

    if (held === undefined || held.leases > 0 || held.controller.busy()) return;
    threads.delete(key);
    held.stop();
    held.controller.dispose();
  };

  const open = (key: string, make: () => ThreadController): Held => {
    const controller = make();

    const held: Held = {
      controller,
      leases: 0,
      stop: controller.subscribe(() => closeIfIdle(key)),
    };

    threads.set(key, held);

    return held;
  };

  return {
    acquire: (key, make) => {
      const held = threads.get(key) ?? (make === null ? null : open(key, make));

      if (held === null) return null;
      held.leases++;
      let released = false;

      return {
        controller: held.controller,
        release: () => {
          if (released) return;
          released = true;
          held.leases--;
          closeIfIdle(key);
        },
      };
    },
  };
};

/** The app's threads, shared by every screen that opens one. */
export const threads = makeThreadRegistry();
