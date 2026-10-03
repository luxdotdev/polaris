/**
 * The id lane in code: a view sets `--id-lane` once (`laneStyle`), and every id and indent in
 * it takes that width in `ch` of the mono id, so ids never wrap and titles line up.
 */
import { cn, type CssVars } from "@polaris/ui";

const LANE = "text-code-inline w-(--id-lane) shrink-0 font-mono";

/** The view's lane, `width` mono characters wide (from `laneWidth`). */
export const laneStyle = (width: number): CssVars => ({ "--id-lane": `${width}ch` });

/** A Task id on the lane: one line, truncated past `max` with the full id on hover. */
export const IdLane = ({
  id,
  max,
  className,
}: {
  readonly id: string;
  readonly max: number;
  readonly className?: string;
}) => (
  <span
    className={cn(LANE, "truncate whitespace-nowrap", className)}
    title={id.length > max ? id : undefined}
  >
    {id}
  </span>
);

/** The lane's width with nothing in it, for a second line or a row without an id. */
export const LaneSpacer = () => <span aria-hidden className={LANE} />;
