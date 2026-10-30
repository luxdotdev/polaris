/** Measures an element's border-box height as it resizes, for content above a virtual list. */
import { useCallback, useState } from "react";

export const useHeight = () => {
  const [height, setHeight] = useState(0);

  const ref = useCallback((node: HTMLElement | null) => {
    if (node === null) return;

    const observer = new ResizeObserver(() => setHeight(Math.round(node.offsetHeight)));

    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return [ref, height] as const;
};
