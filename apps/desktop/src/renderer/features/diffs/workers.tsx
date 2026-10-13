/**
 * Pierre Diffs' setup: our syntax theme, and the worker pool diffs highlight in (ENG-218:
 * without it a 5,000-file Review drops one frame in five). Pierre keeps one pool for the app,
 * made by the first provider to mount with its options, and ends it when the last unmounts.
 */
import { registerCustomTheme } from "@pierre/diffs";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import PierreWorker from "@pierre/diffs/worker/worker.js?worker";
import { type ReactNode, useMemo } from "react";
import { moonlitTheme, THEMES } from "./theme.ts";

registerCustomTheme(THEMES.dark, () => Promise.resolve(moonlitTheme("dark")));

registerCustomTheme(THEMES.light, () => Promise.resolve(moonlitTheme("light")));

/** Review's four workers: the spike measured 50 MB more for 4 than 1, and fewer dropped frames. */
export const POOL_SIZE = 4;

/** Lines longer than this are left unhighlighted and get no word diff. */
export const MAX_LINE_LENGTH = 1000;

const highlighterOptions = {
  theme: THEMES,
  lineDiffType: "word-alt" as const,
  tokenizeMaxLineLength: MAX_LINE_LENGTH,
  maxLineDiffLength: MAX_LINE_LENGTH,
};

export interface DiffWorkersProps {
  readonly children: ReactNode;
  readonly poolSize?: number;
}

export const DiffWorkers = ({ children, poolSize = POOL_SIZE }: DiffWorkersProps) => {
  const poolOptions = useMemo(
    () => ({ workerFactory: () => new PierreWorker(), poolSize }),
    [poolSize]
  );

  return (
    <WorkerPoolContextProvider poolOptions={poolOptions} highlighterOptions={highlighterOptions}>
      {children}
    </WorkerPoolContextProvider>
  );
};
