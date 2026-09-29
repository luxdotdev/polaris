/** A floating layer: surface-raised, card radius, a hairline and the float shadow. */
export const FLOAT_SURFACE =
  "rounded-card border border-hairline bg-surface-raised text-text-default shadow-float outline-hidden";

/** Small reveals fade over 160ms, ease-out; opacity only (DESIGN.md, Motion). */
export const FLOAT_MOTION =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-160 ease-out";
