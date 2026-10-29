import type { Harness } from "../../../lib/hue";
import { DitherField, type DitherFieldProps } from "./field";

export interface LiveDitherProps extends Omit<DitherFieldProps, "hue" | "active"> {
  readonly harness: Harness;
  /** While a Turn runs; false, the field is the still corner. */
  readonly active: boolean;
}

/**
 * DESIGN.md, Dither only on live things: the corner bloom filling its container (position it
 * `relative`) as a background layer, alive while `active`. For the Working strip and live rows.
 */
export const LiveDither = ({ harness, active, ...props }: LiveDitherProps) => (
  <DitherField hue={harness} active={active} {...props} />
);
