import { Effect } from "effect";
import { rejection, type ConstellationCommands } from "./shared.ts";

export const unavailableCommands: ConstellationCommands = {
  command: () =>
    Effect.fail(
      rejection(
        "E-NOT-READY",
        "Constellation commands are not connected",
        "Connect the owning Daemon's Constellations service."
      )
    ),
  status: () =>
    Effect.fail(
      rejection(
        "E-NOT-READY",
        "Constellation status is not connected",
        "Connect the owning Daemon's Constellations service."
      )
    ),
  resolve: () =>
    Effect.fail(
      rejection(
        "E-NOT-READY",
        "Name resolution is not connected",
        "Connect the Host and Constellation catalogs."
      )
    ),
};
