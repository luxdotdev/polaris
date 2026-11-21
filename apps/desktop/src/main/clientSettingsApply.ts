/** Apply preferences through the same handlers used by the Settings UI. */
import { Schema } from "effect";
import { ClientSessionKey, ClientSettingFields } from "../shared/clientSettings.ts";
import { SessionPrefsPatch } from "../shared/contract.ts";
import { DEFAULT_SESSION_PREFS } from "../shared/sessionPrefs.ts";
import type { ClientSettingChange } from "@polaris/protocol";
import type { Settings } from "./settings.ts";
import type { AppUpdates } from "./updates/index.ts";
import type { PredictionBridge } from "./prediction/bridge.ts";
import type { PredictionSettings } from "./prediction/preferences.ts";
import type { MainPredictionPlacement } from "./prediction/placement.ts";

interface Input {
  update: (change: (settings: Settings) => Settings) => void;
  sessions: (patch: SessionPrefsPatch) => void;
  appearance: () => void;
  keybindings: () => void;
  updates: Pick<AppUpdates, "setAutomatic" | "setChannel">;
  prediction: () => {
    settings: PredictionSettings;
    placement: MainPredictionPlacement;
    bridge: Pick<PredictionBridge, "setEnabled">;
  };
}

export const clientPreferenceApplier =
  (input: Input) =>
  (key: string, value: ClientSettingChange["value"] | undefined, hostKey?: string) => {
    if (key.startsWith("sessions.")) {
      const name = Schema.decodeUnknownSync(ClientSessionKey)(key.slice(9));
      input.sessions(
        Schema.decodeUnknownSync(SessionPrefsPatch)({
          [name]: value ?? DEFAULT_SESSION_PREFS[name],
        })
      );

      if (value === undefined)
        input.update((settings) => {
          const sessions = { ...settings.sessions };
          delete sessions[name];

          return { ...settings, sessions };
        });

      return;
    }

    if (key === "automaticAppUpdates")
      input.updates.setAutomatic(
        Schema.decodeUnknownSync(ClientSettingFields.automaticAppUpdates)(value ?? true)
      );
    else if (key === "appUpdateChannel")
      input.updates.setChannel(
        Schema.decodeUnknownSync(ClientSettingFields.appUpdateChannel)(value ?? "stable")
      );
    else if (key === "prediction") {
      if (hostKey === undefined) throw new Error("Choose a Host for prediction preferences");
      const prediction = input.prediction();
      const defaults = Schema.resolveAnnotations(ClientSettingFields.prediction)?.default;
      prediction.settings.set(
        hostKey,
        Schema.decodeUnknownSync(ClientSettingFields.prediction)(value ?? defaults)
      );
      prediction.placement.invalidateHost(hostKey);

      if (value === undefined)
        input.update((settings) => {
          const preferences = { ...settings.prediction };
          delete preferences[hostKey];

          return { ...settings, prediction: preferences };
        });

      return;
    } else if (key === "predictionEnabled") {
      input
        .prediction()
        .bridge.setEnabled(
          Schema.decodeUnknownSync(ClientSettingFields.predictionEnabled)(value ?? false)
        );
    } else if (key === "predictionClientEndpoints") {
      const prediction = input.prediction();
      prediction.settings.setClientEndpoints(
        Schema.decodeUnknownSync(ClientSettingFields.predictionClientEndpoints)(value ?? [])
      );
      prediction.placement.invalidateAll();
    }

    input.update((settings) => {
      const next = { ...settings, [key]: value };

      if (value === undefined) Reflect.deleteProperty(next, key);

      return next;
    });
    input.appearance();

    if (key === "keybindings") input.keybindings();
  };
