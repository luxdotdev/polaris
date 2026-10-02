import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ConstellationSettings } from "@polaris/protocol";
import { Context, Effect, Option, Schema } from "effect";
import { polarisHome } from "../paths.ts";
import { finding, refusal } from "./decision.ts";

/** Hosts persist the user's defaults; the Desktop App broadcasts changes to connected Hosts. */
export class ConstellationDefaultsPath extends Context.Reference<string>(
  "polaris/daemon/constellation/DefaultsPath",
  { defaultValue: () => join(polarisHome(), "constellation-settings.json") }
) {}

const codec = Schema.fromJsonString(ConstellationSettings);

const decode = Schema.decodeUnknownOption(codec);

const encode = Schema.encodeSync(codec);

export const getDefaults = Effect.gen(function* () {
  const path = yield* ConstellationDefaultsPath;
  const text = yield* Effect.promise(() => readFile(path, "utf8").catch(() => null));

  return text === null
    ? ConstellationSettings.make({})
    : Option.getOrElse(decode(text), () => ConstellationSettings.make({}));
});

export const setDefaults = Effect.fn("Constellations.setDefaults")(function* (
  settings: ConstellationSettings
) {
  const path = yield* ConstellationDefaultsPath;
  yield* Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${crypto.randomUUID()}.tmp`;
      await writeFile(temporary, encode(settings));
      await rename(temporary, path);
    },
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
