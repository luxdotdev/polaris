import { useEffect, useState } from "react";

/** The time, refreshed every `ms`; row ages need minutes, so one wake-up a minute. */
export const useNow = (ms = 60_000): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);

    return () => clearInterval(timer);
  }, [ms]);

  return now;
};
