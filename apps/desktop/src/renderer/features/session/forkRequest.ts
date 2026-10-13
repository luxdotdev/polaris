/**
 * Fork… from outside the session (its sidebar row's menu): the session view opens its
 * fork dialog once it is shown and has a finished Turn to fork from.
 */
import { useEffect } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { uiKey } from "./state.ts";

const pending = createStore<string | null>(() => null);

export const requestFork = (hostKey: string, sessionId: string) =>
  pending.setState(uiKey(hostKey, sessionId), true);

/** Runs `open` while a fork is pending for `key`; it returns true once the dialog opened. */
export const useForkRequest = (key: string, open: () => boolean) => {
  const mine = useStore(pending, (k) => k === key);

  useEffect(() => {
    if (mine && open()) pending.setState(null, true);
  });
};
