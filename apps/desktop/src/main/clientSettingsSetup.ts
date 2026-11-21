/** Electron wiring for the Client Settings relay, shared with the Settings handlers. */
import { BrowserWindow } from "electron";
import { CHANNELS, type AppEvent } from "../shared/api.ts";
import { createClientSettingsBridge } from "./clientSettings.ts";
import { clientPreferenceApplier } from "./clientSettingsApply.ts";
import type { Settings } from "./settings.ts";

const publish = (event: AppEvent) => {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(CHANNELS.app, event);
};

export const publishClientPrediction = (before: Settings, after: Settings) => {
  if (
    before.predictionEnabled === after.predictionEnabled &&
    before.predictionConfigured === after.predictionConfigured &&
    before.predictionClientEndpoints === after.predictionClientEndpoints
  )
    return;
  publish({
    kind: "client-prediction",
    enabled: after.predictionEnabled ?? false,
    configured: after.predictionConfigured ?? false,
    clientEndpoints: after.predictionClientEndpoints ?? [],
  });
};

type ApplyInput = Omit<Parameters<typeof clientPreferenceApplier>[0], "keybindings">;

export const desktopClientSettings = (get: () => Settings, input: ApplyInput) =>
  createClientSettingsBridge({
    get: (hostKey) => {
      const { prediction: preferences, ...rest } = get();
      const prediction = hostKey === undefined ? undefined : preferences?.[hostKey];

      if (prediction === undefined) return rest;

      return { ...rest, prediction };
    },
    apply: clientPreferenceApplier({
      ...input,
      keybindings: () => publish({ kind: "keybindings", keybindings: get().keybindings ?? {} }),
    }),
    publish,
  });
