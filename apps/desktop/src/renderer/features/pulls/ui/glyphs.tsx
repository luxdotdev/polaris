/** The PR list's glyphs, drawn as in Paper R3 (14–16px, 1.25 stroke, currentColor). */
import type { SVGProps } from "react";

type GlyphProps = SVGProps<SVGSVGElement> & { readonly size?: number };

const Glyph = ({ size = 14, children, ...props }: GlyphProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.25}
    aria-hidden="true"
    focusable="false"
    className="shrink-0"
    {...props}
  >
    {children}
  </svg>
);

/** A pull request: two commits and the arrow back to the base. */
export const PullGlyph = (props: GlyphProps) => (
  <Glyph {...props}>
    <circle cx="4" cy="3.5" r="1.5" />
    <circle cx="4" cy="12.5" r="1.5" />
    <circle cx="12" cy="12.5" r="1.5" />
    <path d="M4 5v6M12 11V6.5c0-1.4-.8-2-2-2H7.5M9 3l-1.5 1.5L9 6" />
  </Glyph>
);

export const LinkGlyph = (props: GlyphProps) => (
  <Glyph {...props}>
    <path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1" />
  </Glyph>
);

export const PersonGlyph = (props: GlyphProps) => (
  <Glyph size={16} {...props}>
    <circle cx="8" cy="5.5" r="2.5" />
    <path d="M3 13.5c.6-2.3 2.6-3.5 5-3.5s4.4 1.2 5 3.5" />
  </Glyph>
);
