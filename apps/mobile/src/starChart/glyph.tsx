/**
 * A star's body by state (DESIGN.md, Star states): done white, working white with the Working
 * dither inside, review amber, blocked or failed red, waiting a hollow grey ring. Never a halo.
 */
import { Match } from "effect";
import { View } from "react-native";
import { Circle, G } from "react-native-svg";
import { Dither } from "../dither/index.ts";
import type { MobileColours } from "../theme/index.ts";
import type { StarState } from "./types.ts";

/** Paper MX-W's radii: working and review read larger than settled stars. */
export const starRadius = (state: StarState): number =>
  Match.value(state).pipe(
    Match.when("working", () => 5),
    Match.when("review", () => 5),
    Match.when("waiting", () => 3.5),
    Match.orElse(() => 4)
  );

/** A working body's ground: white at 30% over the panel, under the dither. */
const WORKING_GROUND = 0.3;

interface BodyProps {
  readonly state: StarState;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly colours: MobileColours;
}

/** The body as SVG; a working star's dither is drawn over it by `WorkingField`. */
export const StarBody = ({ state, x, y, r, colours }: BodyProps) =>
  Match.value(state).pipe(
    Match.when("waiting", () => (
      <Circle cx={x} cy={y} r={r} fill={colours.panel} stroke={colours.textFaint} strokeWidth={1} />
    )),
    Match.when("working", () => (
      <G>
        <Circle cx={x} cy={y} r={r} fill={colours.panel} />
        <Circle cx={x} cy={y} r={r} fill={colours.textDefault} fillOpacity={WORKING_GROUND} />
      </G>
    )),
    Match.orElse(() => <Circle cx={x} cy={y} r={r} fill={fillOf(state, colours)} />)
  );

export const fillOf = (state: StarState, colours: MobileColours): string =>
  Match.value(state).pipe(
    Match.when("review", () => colours.needsYou),
    Match.whenOr("blocked", "failed", () => colours.failed),
    Match.when("waiting", () => colours.panel),
    Match.orElse(() => colours.textDefault)
  );

/** The selected star's crisp ring (MX-AG), outside the body. */
export const SelectionRing = ({ x, y, r, colours }: Omit<BodyProps, "state">) => (
  <Circle cx={x} cy={y} r={r + 3} fill="none" stroke={colours.textStrong} strokeWidth={1.5} />
);

interface FieldProps {
  readonly size: number;
  readonly colours: MobileColours;
}

/** The Working dither clipped to a round body `size` points across (a multiple of 2). */
export const WorkingField = ({ size, colours }: FieldProps) => (
  <View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden" }}>
    <Dither color={colours.textDefault} size={size} moving />
  </View>
);
