/**
 * The iPhone Duo's posture (DESIGN.md, iPhone Duo): folded, unfolded with two halves side by side
 * (D6, D9), or half-folded with a top and a bottom half (D7, D8). Pure: the native module reports
 * the hinge and the fold's division region; this decides the halves.
 */
import { Option, Schema } from "effect";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type HingeStatus = "unknown" | "closed" | "partiallyOpen" | "fullyOpen";

/** What PolarisHinge reports: the hinge (null off a Duo) and the division regions, in points. */
export interface HingeReport {
  readonly hinge: { readonly status: HingeStatus; readonly angle: number } | null;
  readonly width: number;
  readonly height: number;
  readonly divisions: ReadonlyArray<Rect>;
}

export type Posture =
  | { readonly kind: "folded" }
  | {
      readonly kind: "unfolded";
      readonly first: Rect;
      readonly second: Rect;
      readonly division: Rect;
    }
  | {
      readonly kind: "halfFolded";
      readonly top: Rect;
      readonly bottom: Rect;
      readonly division: Rect;
    };

export const FOLDED: Posture = { kind: "folded" };

const split = (report: HingeReport, division: Rect) => {
  const vertical = division.height >= division.width;

  const before: Rect = vertical
    ? { x: 0, y: 0, width: division.x, height: report.height }
    : { x: 0, y: 0, width: report.width, height: division.y };

  const after: Rect = vertical
    ? {
        x: division.x + division.width,
        y: 0,
        width: report.width - division.x - division.width,
        height: report.height,
      }
    : {
        x: 0,
        y: division.y + division.height,
        width: report.width,
        height: report.height - division.y - division.height,
      };

  return { vertical, before, after };
};

/**
 * Folded, a closed hinge, or no division: the iPhone app unchanged. Partly open over a horizontal
 * fold (tabletop): the top and bottom halves. Otherwise open: two halves across the division.
 */
export const postureOf = (report: HingeReport | null): Posture => {
  const division = report?.divisions[0];

  if (report === null || report.hinge === null || division === undefined) return FOLDED;

  const { status } = report.hinge;

  if (status === "closed" || status === "unknown") return FOLDED;

  const { vertical, before, after } = split(report, division);

  if (before.width <= 0 || before.height <= 0 || after.width <= 0 || after.height <= 0)
    return FOLDED;

  return status === "partiallyOpen" && !vertical
    ? { kind: "halfFolded", top: before, bottom: after, division }
    : { kind: "unfolded", first: before, second: after, division };
};

const RectSchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});

const HingeReportSchema = Schema.Struct({
  hinge: Schema.NullOr(
    Schema.Struct({
      status: Schema.Literals(["unknown", "closed", "partiallyOpen", "fullyOpen"]),
      angle: Schema.Number,
    })
  ),
  width: Schema.Number,
  height: Schema.Number,
  divisions: Schema.Array(RectSchema),
});

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(HingeReportSchema));

/** The native module's JSON report, or null when it can't be read. */
export const readReport = (json: string): HingeReport | null => Option.getOrNull(decode(json));
