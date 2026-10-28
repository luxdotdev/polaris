/** A condition the screen shows only once it has held for `ms`, so brief reconnects stay quiet. */
import { useEffect, useState } from "react";

/** How long a Host may be away before a screen says so (ENG-498). */
export const RECONNECT_GRACE_MS = 5_000;

export const useAfter = (condition: boolean, ms: number = RECONNECT_GRACE_MS): boolean => {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!condition) {
      setHeld(false);

      return;
    }

    const timer = setTimeout(() => setHeld(true), ms);

    return () => clearTimeout(timer);
  }, [condition, ms]);

  return condition && held;
};
