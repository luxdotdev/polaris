import { readGroup, writeGroup } from "../settings/index.ts";
import { join } from "node:path";
import { FileError, VisualsSettings } from "@polaris/protocol";
import { Context, Effect, Layer } from "effect";
import { paths } from "../paths.ts";

export interface VisualsSettingsService {
  /** Read from the file each time, so every reader in the Daemon sees the last write. */
  readonly settings: Effect.Effect<VisualsSettings>;
  readonly setSettings: (settings: VisualsSettings) => Effect.Effect<void, FileError>;
}

/** The Visuals setting saved at `path`; a missing or unreadable file is the default, `rich`. */
export const visualsFile = (path: string): VisualsSettingsService => ({
  settings: Effect.sync(() => readGroup(path, "visuals")),
  setSettings: (settings) =>
    Effect.try({
      try: () => writeGroup(path, "visuals", settings),
      catch: (cause) =>
        new FileError({
          path,
          code: "EIO",
          message: `Could not save the visuals setting: ${String(cause)}`,
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
