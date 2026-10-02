/** Pixel art from design/assets, themed through the CSS variables in app/globals.css. */
export type PixelArt =
  | "star"
  | "hand"
  | "constellation"
  | "dither-claude"
  | "dither-codex"
  | "logo";

// Whole class names, so Tailwind's scanner emits each utility.
const artClass = {
  star: "px-star",
  hand: "px-hand",
  constellation: "px-constellation",
  "dither-claude": "px-dither-claude",
  "dither-codex": "px-dither-codex",
  logo: "px-logo",
} satisfies Record<PixelArt, string>;

export function Pixel({
  art,
  size,
  className = "",
}: {
  readonly art: PixelArt;
  readonly size: number;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`px-icon ${artClass[art]} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
