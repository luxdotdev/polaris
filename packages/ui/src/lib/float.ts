/** A floating layer: surface-raised, card radius, a hairline and the float shadow. */
export const FLOAT_SURFACE =
  "rounded-card border border-hairline bg-surface-raised text-text-default shadow-float outline-hidden";

/** Small reveals fade in over 160ms, ease-out, and close at once (DESIGN.md, Motion). */
export const FLOAT_MOTION =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 duration-160 ease-out";

/** A mount-only reveal: fades in over 160ms, ease-out. */
export const REVEAL_MOTION = "animate-in fade-in-0 duration-160 ease-out";

/** Tooltips: the first one fades in over 160ms; later ones (skip-delay) and closing are instant. */
export const TOOLTIP_MOTION =
  "data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 duration-160 ease-out";
