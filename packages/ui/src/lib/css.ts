import type { CSSProperties } from "react";

/** Inline styles that may also set custom properties. */
export type CssVars = CSSProperties & {
  readonly [name: `--${string}`]: string | number | undefined;
};
