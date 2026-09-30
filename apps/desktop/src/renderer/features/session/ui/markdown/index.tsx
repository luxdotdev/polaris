/**
 * Assistant prose as Markdown. The renderer is its own chunk, fetched on idle
 * after the first conversation mounts; until it arrives a message shows as
 * plain text in the same type, so nothing waits on it.
 */
import { lazy, Suspense } from "react";
import { softWrap } from "../softWrap.tsx";

const load = () => import("./Streamed.tsx");

const Streamed = lazy(load);

let preloaded = false;

/** Fetch the Markdown chunk when the renderer is idle; once. */
export const preloadMarkdown = () => {
  if (preloaded) return;
  preloaded = true;
  requestIdleCallback(() => void load(), { timeout: 2000 });
};

const Plain = ({ text }: { readonly text: string }) => (
  <p className="break-words whitespace-pre-wrap">{softWrap(text)}</p>
);

export const Markdown = ({ text, live }: { readonly text: string; readonly live: boolean }) => (
  <Suspense fallback={<Plain text={text} />}>
    <Streamed text={text} live={live} />
  </Suspense>
);
