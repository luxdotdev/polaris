/**
 * The one clock every moving dither steps on: a loop that runs only while a moving glyph is
 * mounted and Reduce Motion is off. React Native's binding is in Dither.tsx.
 */

export interface Loop<V> {
  /** What glyphs read their frame from (an Animated.Value on the phone). */
  readonly value: V;
  readonly stop: () => void;
}

export interface ClockState<V> {
  readonly reduceMotion: boolean;
  /** The running loop's value; null while nothing moves. */
  readonly value: V | null;
}

export interface DitherClock<V> {
  /** A moving glyph mounted; the returned function is its unmount. */
  readonly acquire: () => () => void;
  readonly setReduceMotion: (reduce: boolean) => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly snapshot: () => ClockState<V>;
}

/**
 * `start` begins a loop and calls `interrupted` if it ends on its own (React Native stops an
 * animation whose last view detached), so the clock starts a fresh one.
 */
export const ditherClock = <V>(start: (interrupted: () => void) => Loop<V>): DitherClock<V> => {
  let users = 0;
  let loop: Loop<V> | null = null;
  let state: ClockState<V> = { reduceMotion: false, value: null };
  const listeners = new Set<() => void>();

  const publish = (next: ClockState<V>) => {
    state = next;

    for (const listener of listeners) listener();
  };

  const sync = () => {
    const run = users > 0 && !state.reduceMotion;

    if (run && loop === null) {
      const started: Loop<V> = start(() => {
        if (loop !== started) return;
        loop = null;
        sync();
      });

      loop = started;
      publish({ ...state, value: started.value });
    }

    if (!run && loop !== null) {
      const stopping = loop;

      loop = null;
      stopping.stop();
      publish({ ...state, value: null });
    }
  };

  return {
    acquire: () => {
      let held = true;

      users += 1;
      sync();

      return () => {
        if (!held) return;
        held = false;
        users -= 1;
        sync();
      };
    },
    setReduceMotion: (reduce) => {
      if (reduce === state.reduceMotion) return;
      publish({ ...state, reduceMotion: reduce });
      sync();
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    snapshot: () => state,
  };
};
