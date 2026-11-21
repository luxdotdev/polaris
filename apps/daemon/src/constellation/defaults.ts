import { readGroup, writeGroup } from "../settings/index.ts";
import { join } from "node:path";
import { ConstellationSettings } from "@polaris/protocol";
import { Context, Effect } from "effect";
import { polarisHome } from "../paths.ts";
import { finding, refusal } from "./decision.ts";

/** Hosts persist the user's defaults; the Desktop App broadcasts changes to connected Hosts. */
export class ConstellationDefaultsPath extends Context.Reference<string>(
  "polaris/daemon/constellation/DefaultsPath",
  { defaultValue: () => join(polarisHome(), "constellation-settings.json") }
) {}

export const getDefaults = Effect.gen(function* () {
  const path = yield* ConstellationDefaultsPath;

  return readGroup(path, "constellation");
});

export const setDefaults = Effect.fn("Constellations.setDefaults")(function* (
  settings: ConstellationSettings
) {
  const path = yield* ConstellationDefaultsPath;
  yield* Effect.try({
    try: () => writeGroup(path, "constellation", settings),
    catch: () =>
      refusal(undefined, [
        finding(
          "E-DEFAULTS",
          "Could not save Constellation defaults",
          "Retry the settings change."
        ),
      ]),
  });

  return { settings };
});
