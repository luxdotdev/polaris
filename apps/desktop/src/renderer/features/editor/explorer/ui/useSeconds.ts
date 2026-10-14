/** Whole seconds since `since`, ticking once a second only while `since` is set. */
import { useEffect, useState } from "react";

export const useSeconds = (since: number | null) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [since]);

  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
};
