/**
 * ⌃` (Control and the key left of 1, whatever the layout prints on it): one
 * listener for the app, acting on whichever drawer is mounted in the current mode.
 */
import { useEffect, useRef } from "react";

let mounted: { readonly current: () => void } | null = null;

/** The mounted drawer's toggle; the latest mount wins. */
export const useToggleTarget = (toggle: () => void) => {
  const latest = useRef(toggle);

  latest.current = toggle;
  useEffect(() => {
    const target = { current: () => latest.current() };

    mounted = target;

    return () => {
      if (mounted === target) mounted = null;
    };
  }, []);
};

/** Mounted once by the shell. */
export const useTerminalKey = () =>
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Backquote" || !event.ctrlKey || event.metaKey || event.altKey) return;

      if (mounted === null) return;
      event.preventDefault();
      mounted.current();
    };

    window.addEventListener("keydown", onKey, { capture: true });

    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);
