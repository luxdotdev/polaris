/**
 * Edit mode is its own chunk (the explorer, the git gutter and CodeMirror's
 * core), fetched the first time Edit opens, so Orchestrate never carries it.
 */
import { lazy, Suspense } from "react";

const View = lazy(() => import("./EditMode.tsx").then((m) => ({ default: m.EditMode })));

export const EditMode = () => (
  <Suspense fallback={<div className="bg-bg flex-1" />}>
    <View />
  </Suspense>
);
