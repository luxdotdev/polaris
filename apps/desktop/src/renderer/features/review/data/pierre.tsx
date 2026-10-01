/**
 * Pierre Diffs' setup for Review: our syntax theme, and the worker pool every diff
 * highlights in (ENG-218: without it a 5,000-file Review drops one frame in five). The
 * pool lives while a Review subject is open and is torn down when the view unmounts.
 */
import { registerCustomTheme } from "@pierre/diffs";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import PierreWorker from "@pierre/diffs/worker/worker.js?worker";
import type { ReactNode } from "react";
import { moonlitTheme, THEME_NAME } from "../model/theme.ts";

registerCustomTheme(THEME_NAME, () => Promise.resolve(moonlitTheme()));

/** Four workers: the spike measured 50 MB more for 4 than 1, and fewer dropped frames. */
export const POOL_SIZE = 4;

/** Lines longer than this are left unhighlighted and get no word diff. */
export const MAX_LINE_LENGTH = 1000;

const poolOptions = { workerFactory: () => new PierreWorker(), poolSize: POOL_SIZE };

const highlighterOptions = {
  theme: THEME_NAME,
  lineDiffType: "word-alt" as const,
  tokenizeMaxLineLength: MAX_LINE_LENGTH,
  maxLineDiffLength: MAX_LINE_LENGTH,
};

export const DiffWorkers = ({ children }: { readonly children: ReactNode }) => (
  <WorkerPoolContextProvider poolOptions={poolOptions} highlighterOptions={highlighterOptions}>
    {children}
  </WorkerPoolContextProvider>
);
