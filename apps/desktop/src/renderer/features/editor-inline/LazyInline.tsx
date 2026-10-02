/** The inline feature's chunk, loaded the first time Edit mode opens (it brings the editor's). */
import { lazy, Suspense } from "react";

const Installed = lazy(() => import("./Installed.tsx"));

export const LazyInline = () => (
  <Suspense fallback={null}>
    <Installed />
  </Suspense>
);
