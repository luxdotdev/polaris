/**
 * Harness availability per Host (ENG-201): whether each catalogue Harness is
 * installed, recent enough and signed in. The Daemon learns sign-in from the
 * Harness's own status command, never from its credentials (ADR 0001).
 */
import { Schema, SchemaTransformation } from "effect";
import { Timestamp } from "./domain.ts";
import { HarnessKind } from "./harnesses.ts";

/**
 * `not-installed`, `outdated` (below the catalogue's `minVersion`),
 * `needs-sign-in`, `ready`, or `unknown` when the Harness couldn't say.
 */
export const HarnessStatus = Schema.Literals([
  "not-installed",
  "outdated",
  "needs-sign-in",
  "ready",
  "unknown",
]);

export type HarnessStatus = typeof HarnessStatus.Type;

const isHarnessStatus = Schema.is(HarnessStatus);

/** A status as it travels: one this build doesn't know decodes as `unknown`. */
const HarnessStatusWire = Schema.String.pipe(
  Schema.decodeTo(
    HarnessStatus,
    SchemaTransformation.transform<HarnessStatus, string>({
      decode: (status) => (isHarnessStatus(status) ? status : "unknown"),
      encode: (status) => status,
    })
  )
);

export class HarnessAvailability extends Schema.Class<HarnessAvailability>("HarnessAvailability")({
  harness: HarnessKind,
  status: HarnessStatusWire,
  /** The installed version, when the Harness reported one. */
  version: Schema.NullOr(Schema.String),
  /** The oldest version this Daemon's driver supports. */
  minVersion: Schema.String,
  /** Why it isn't ready, in the Harness's words where it gave some; null when ready. */
  detail: Schema.NullOr(Schema.String),
  /**
   * The Harness's own sign-in, to run on the Host with `terminal.open` as
   * `argv`; null when it isn't installed. The binary is the one the Daemon found.
   */
  signInArgv: Schema.NullOr(Schema.Array(Schema.String)),
}) {}

/** Every catalogue Harness this Daemon has a driver for, in catalogue order. */
export class HostHarnesses extends Schema.Class<HostHarnesses>("HostHarnesses")({
  harnesses: Schema.Array(HarnessAvailability),
  /** When the Daemon last probed; results are cached until a Client asks again. */
  checkedAt: Timestamp,
}) {}
