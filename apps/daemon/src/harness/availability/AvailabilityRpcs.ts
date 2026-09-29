/** Handlers for `harness.availability` and `harness.watchAvailability`. */
import { HarnessAvailabilityQuery, WatchHarnessAvailability } from "@polaris/protocol";
import { Effect } from "effect";
import { RpcGroup } from "effect/rpc";
import { Availability } from "./Availability.ts";

export class AvailabilityRpcs extends RpcGroup.make(
  HarnessAvailabilityQuery,
  WatchHarnessAvailability
) {}

/** Requires `Availability`. */
export const AvailabilityRpcsLive = AvailabilityRpcs.toLayer(
  Effect.gen(function* () {
    const availability = yield* Availability;

    return {
      "harness.availability": ({ refresh }) => availability.get(refresh),
      "harness.watchAvailability": () => availability.changes,
    };
  })
);
