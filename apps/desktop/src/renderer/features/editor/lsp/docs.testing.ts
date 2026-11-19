import { cleanup, waitFor } from "@testing-library/react";

/** Every fenced block has its highlighted lines (the highlighter loads after the first render). */
const highlighted = () =>
  [...document.querySelectorAll('[data-md="code-block"] pre code')].every(
    (code) => code.textContent === "" || code.querySelector(".line") !== null
  );

/** Lets the highlighter land on every rendered fence before the DOM goes away, then cleans up. */
export const cleanupDocs = async () => {
  await waitFor(() => {
    if (!highlighted()) throw new Error("a fence is still being highlighted");
  });
  cleanup();
};
