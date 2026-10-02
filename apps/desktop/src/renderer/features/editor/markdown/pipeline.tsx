import { type Components, defaultRehypePlugins } from "streamdown";
import { previewHeadings } from "./headings.ts";

// Host routing owns URL hardening; Streamdown's default harden blocks relative paths before it.
export const PREVIEW_REHYPE = [
  ...Object.entries(defaultRehypePlugins)
    .filter(([name]) => name === "raw" || name === "sanitize")
    .map(([, plugin]) => plugin),
  previewHeadings,
];

/** Never let raw HTML picture sources bypass the image component's media policy. */
export const SAFE_HTML_COMPONENTS: Components = {
  source: () => null,
  picture: ({ children }) => <>{children}</>,
};
