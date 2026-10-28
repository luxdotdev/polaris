/** Reduce Motion and the shared dither clock: one interval for every Working tile on screen. */
import { useEffect, useState, useSyncExternalStore } from "react";
import { AccessibilityInfo, AppState } from "react-native";
import { DITHER_FRAME_MS, DITHER_FRAMES } from "./dither.ts";

export const useReduceMotion = (): boolean => {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let mounted = true;

    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduce(value);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduce;
};

let frame = 0;

const listeners = new Set<() => void>();

let timer: ReturnType<typeof setInterval> | null = null;

const tick = () => {
  frame = (frame + 1) % DITHER_FRAMES;

  for (const listener of listeners) listener();
};

const sync = () => {
  const run = listeners.size > 0 && AppState.currentState === "active";

  if (run && timer === null) timer = setInterval(tick, DITHER_FRAME_MS);

  if (!run && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
};

AppState.addEventListener("change", sync);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  sync();

  return () => {
    listeners.delete(listener);
    sync();
  };
};

const noSubscribe = () => () => {};

/** The current dither frame, stepping only while a Working tile is mounted and motion is allowed. */
export const useDitherFrame = (still: boolean): number =>
  useSyncExternalStore(still ? noSubscribe : subscribe, () => (still ? 0 : frame));
