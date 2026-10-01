/**
 * The Working strip's line: one verb from the list, a new one every 6 s from a
 * random start (as ChatDCA does), faded in over 160 ms; Reduce Motion swaps it
 * instantly. Mounted only while a Turn runs, so its timer never runs at idle.
 */
import { useEffect, useState } from "react";
import { startIndex, VERB_ROTATE_MS } from "./model.ts";

export interface RotatingVerbProps {
  readonly verbs: ReadonlyArray<string>;
  /** What a screen reader hears instead of each verb: "Claude Code is working". */
  readonly spoken: string;
}

export const RotatingVerb = ({ verbs, spoken }: RotatingVerbProps) => {
  const [index, setIndex] = useState(() => startIndex(verbs.length));
  const count = verbs.length;

  useEffect(() => {
    if (count < 2) return undefined;

    const timer = setInterval(() => setIndex((i) => (i + 1) % count), VERB_ROTATE_MS);

    return () => clearInterval(timer);
  }, [count]);

  const verb = verbs[index % Math.max(1, count)] ?? spoken;

  return (
    <>
      <span key={verb} aria-hidden className="polaris-verb-in" data-testid="working-verb">
        {verb}
      </span>
      <span className="sr-only">{spoken}</span>
    </>
  );
};
