/** The chip's small glyphs (Paper R4, R5): drawn in `currentColor`, still (only the dither loops). */

/** In progress: a quarter arc over a faint ring. */
export const ProgressGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
    <circle
      cx="6"
      cy="6"
      r="4.5"
      fill="none"
      stroke="currentColor"
      strokeOpacity="0.2"
      strokeWidth="1.5"
    />
    <path
      d="M6 1.5a4.5 4.5 0 0 1 4.5 4.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

export const WarningGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
    <path
      d="M8 2.5l6 10.5H2z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    <path
      d="M8 7v2.5M8 11.2v.3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

export const CodeGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
    <path
      d="M6 4L2.5 8 6 12M10 4l3.5 4L10 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
    />
  </svg>
);

export const CheckGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
    <path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

/** A Host's dot: filled when connected, hollow while reconnecting, dashed when away. */
export const HostDot = ({ kind }: { readonly kind: "on" | "reconnecting" | "away" }) => (
  <span
    aria-hidden="true"
    className={
      kind === "on"
        ? "bg-diff-added-text size-1.5 shrink-0 rounded-full"
        : `border-text-subtle size-1.5 shrink-0 rounded-full border ${kind === "away" ? "border-dashed" : ""}`
    }
  />
);

export const PlayGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
    <path
      d="M3 2v8l7-4z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinejoin="round"
    />
  </svg>
);
