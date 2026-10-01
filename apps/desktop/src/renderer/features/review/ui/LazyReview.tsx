/**
 * The Review view is its own chunk (Pierre Diffs and Shiki's core are ~600 KB minified),
 * fetched when the renderer is first idle after launch, so opening Review never waits on it.
 */
import { lazy, Suspense } from "react";
import type { ReviewViewProps } from "./ReviewView.tsx";

const load = () => import("./ReviewView.tsx").then((m) => ({ default: m.ReviewView }));

const View = lazy(load);

let preloaded = false;

/** Fetch the chunk when the renderer is idle; once. */
export const preloadReview = () => {
  if (preloaded) return;

  preloaded = true;
  requestIdleCallback(() => void load(), { timeout: 5000 });
};

export const ReviewView = (props: ReviewViewProps) => (
  <Suspense fallback={<div className="bg-bg flex-1" />}>
    <View {...props} />
  </Suspense>
);
