import { useEffect, useState } from "react";

/**
 * True for `ms` after `present` turns false, so a leaving element can play its exit before
 * it unmounts. Reduce Motion zeroes the exit animation; the element still goes after `ms`.
 */
export function useExitPresence(present: boolean, ms: number): boolean {
  const [previous, setPrevious] = useState(present);
  const [leaving, setLeaving] = useState(false);

  if (previous !== present) {
    setPrevious(present);
    setLeaving(!present);
  }

  useEffect(() => {
    if (!leaving) return;

    const timer = setTimeout(() => setLeaving(false), ms);

    return () => clearTimeout(timer);
  }, [leaving, ms]);

  return leaving;
}
