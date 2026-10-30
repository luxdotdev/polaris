import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_VISUALS, FileError, VisualsSettings } from "@polaris/protocol";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { paths } from "../paths.ts";

const SettingsJson = Schema.fromJsonString(VisualsSettings);

const decode = Schema.decodeUnknownOption(SettingsJson);

const encode = Schema.encodeSync(SettingsJson);

export interface VisualsSettingsService {
  /** Read from the file each time, so every reader in the Daemon sees the last write. */
  readonly settings: Effect.Effect<VisualsSettings>;
  readonly setSettings: (settings: VisualsSettings) => Effect.Effect<void, FileError>;
}

/** The Visuals setting saved at `path`; a missing or unreadable file is the default, `rich`. */
export const visualsFile = (path: string): VisualsSettingsService => ({
  settings: Effect.promise(() => readFile(path, "utf8").catch(() => null)).pipe(
    Effect.map((text) =>
      text === null ? DEFAULT_VISUALS : Option.getOrElse(decode(text), () => DEFAULT_VISUALS)
    )
  ),
  // Written to a temporary file and renamed, so a crash never leaves half a file.
  setSettings: (settings) =>
    Effect.tryPromise({
      try: async () => {
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.${process.pid}.tmp`;
        await writeFile(temporary, encode(settings));
        await rename(temporary, path);
      },
      catch: (cause) =>
        new FileError({
          path,
          code: "EIO",
          message: `Could not save the Visuals setting: ${String(cause)}`,
        }),
    }),
});

/** The Host's Visuals setting, in `~/.polaris/visuals-settings.json` unless a test provides one. */
export class VisualsSettingsStore extends Context.Reference<VisualsSettingsService>(
  "polaris/visuals/Settings",
  { defaultValue: () => visualsFile(join(paths().root, "visuals-settings.json")) }
) {
  static readonly file = (path: string) => Layer.succeed(VisualsSettingsStore, visualsFile(path));
}
