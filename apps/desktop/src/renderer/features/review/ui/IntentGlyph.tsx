/**
 * An Intent Group's category as a neutral line glyph (Paper R11): `text-subtle`, never a
 * colour, since rule/colour-means-something keeps colour for state and Severity.
 */
import type { IntentCategory } from "@polaris/protocol";
import type { ReactNode } from "react";

const GLYPHS: Readonly<Record<IntentCategory, ReactNode>> = {
  ui: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 6h12" />
    </>
  ),
  api: <path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13" />,
  core: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="1.5" />
    </>
  ),
  data: (
    <>
      <ellipse cx="8" cy="4" rx="5" ry="2" />
      <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
    </>
  ),
  cli: <path d="M3 4l4 4-4 4M8.5 12H13" />,
  security: (
    <path d="M8 1.8l5 2v4c0 3-2.2 5.2-5 6.4C5.2 13 3 10.8 3 7.8v-4zM6 8l1.5 1.5L10.5 6.5" />
  ),
  tests: <path d="M6 2v4.5L3 13.5h10L10 6.5V2M5 2h6M4.5 10h7" />,
  docs: <path d="M4 2h5.5L12 4.5V14H4zM6 7.5h4M6 10h4" />,
  examples: (
    <>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M6.5 6v4l3.5-2z" />
    </>
  ),
  deps: <path d="M2.5 5L8 2.5 13.5 5v6L8 13.5 2.5 11zM2.5 5L8 7.5 13.5 5M8 7.5v6" />,
  build: <path d="M2.5 13.5l6-6M9 2.5l4.5 4.5-2 2L7 4.5z" />,
  scripts: (
    <path d="M6 2.5c-1.5 0-2 .5-2 2V6c0 1-.5 1.5-1.5 2 1 .5 1.5 1 1.5 2v1.5c0 1.5.5 2 2 2M10 2.5c1.5 0 2 .5 2 2V6c0 1 .5 1.5 1.5 2-1 .5-1.5 1-1.5 2v1.5c0 1.5-.5 2-2 2" />
  ),
  config: (
    <>
      <path d="M2.5 4.5h11M2.5 11.5h11" />
      <circle cx="6" cy="4.5" r="1.75" />
      <circle cx="10" cy="11.5" r="1.75" />
    </>
  ),
  i18n: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11M8 2.5c2 2 2 9 0 11M8 2.5c-2 2-2 9 0 11" />
    </>
  ),
  assets: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <circle cx="6" cy="6.5" r="1.25" />
      <path d="M2.5 12l4-3.5 2.5 2.5 2-1.5 2.5 2" />
    </>
  ),
  other: (
    <>
      <circle cx="4" cy="8" r="0.75" />
      <circle cx="8" cy="8" r="0.75" />
      <circle cx="12" cy="8" r="0.75" />
    </>
  ),
};

export const IntentGlyph = ({ category }: { readonly category: IntentCategory }) => (
  <svg
    width={14}
    height={14}
    viewBox="0 0 16 16"
    aria-hidden="true"
    data-category={category}
    className="text-text-subtle shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.25}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {GLYPHS[category]}
  </svg>
);
