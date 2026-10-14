import { cleanup, waitFor } from "@testing-library/react";

/** Shiki themes a fenced block after its first render, setting `--shiki-dark` on the `pre`. */
const highlighted = () =>
  [...document.querySelectorAll('pre[class*="language-"]')].every((pre) =>
    pre.getAttribute("style")?.includes("--shiki-dark")
  );

/** Lets Shiki land on every rendered fence before the DOM goes away, then cleans up. */
export const cleanupDocs = async () => {
  await waitFor(() => {
    if (!highlighted()) throw new Error("a fence is still being highlighted");
  });
  cleanup();
};
