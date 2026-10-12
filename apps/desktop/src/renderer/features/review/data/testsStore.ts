/**
 * "Hide tests" in Review, remembered on this Mac (this window's `localStorage`) for every
 * Review: the "+ N tests hidden" / "Hide N tests" row flips it.
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

const KEY = "polaris.review.hideTests.v1";

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const read = (): boolean => {
  try {
    return storage()?.getItem(KEY) === "true";
  } catch {
    return false;
  }
};

export const testsStore = createStore<{ readonly hidden: boolean }>(() => ({ hidden: read() }));

export const useTestsHidden = (): boolean => useStore(testsStore, (s) => s.hidden);

export const setTestsHidden = (hidden: boolean) => {
  testsStore.setState({ hidden });

  try {
    storage()?.setItem(KEY, String(hidden));
  } catch {
    // Not remembered this time; the choice still holds in this window.
  }
};
