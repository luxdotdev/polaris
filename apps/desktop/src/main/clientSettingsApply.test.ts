import { expect, test } from "bun:test";
import { Schema } from "effect";
import { createClientSettingsBridge } from "./clientSettings.ts";
import { clientPreferenceApplier } from "./clientSettingsApply.ts";
import { type Settings } from "./settings.ts";
import { PredictionSettings } from "./prediction/preferences.ts";
import { MainPredictionPlacement } from "./prediction/placement.ts";
import { fixture } from "./updates/updates.testing.ts";
import { DEFAULT_PREDICTION_PREFERENCES } from "../shared/predictionPlacement.ts";

const setup = () => {
  let settings: Settings = { hosts: [{ alias: "private-host" }] };

  const update = (change: (current: Settings) => Settings) => {
    settings = change(settings);
  };

  const preferences = new PredictionSettings(
    () => settings,
    (next) => update(() => next)
  );

  const placement = new MainPredictionPlacement({
    preferences,
    client: async () => null,
    host: async () => null,
  });

  const updates = fixture({
    supported: false,
    save: (patch) => update((current) => ({ ...current, ...patch })),
  });

  const bridge = createClientSettingsBridge({
    get: (hostKey) => {
      const { prediction, ...rest } = settings;
      const pref = hostKey === undefined ? undefined : prediction?.[hostKey];

      if (pref === undefined) return rest;

      return { ...rest, prediction: pref };
    },
    apply: clientPreferenceApplier({
      update,
      sessions: (patch) =>
        update((current) => ({ ...current, sessions: { ...current.sessions, ...patch } })),
      appearance: () => {},
      keybindings: () => {},
      updates: updates.updates,
      prediction: () => ({
        settings: preferences,
        placement,
        bridge: {
          setEnabled: () => {
            throw new Error("not exercised");
          },
        },
      }),
    }),
    publish: () => {},
  });

  return { bridge, get: () => settings, preferences, updates };
};

test("relayed update Channel and automatic update changes are refused before apply", () => {
  const f = setup();

  try {
    expect(() => f.bridge.apply("automaticAppUpdates", false, "automatic")).toThrow(
      "Only the user"
    );
    expect(() => f.bridge.apply("appUpdateChannel", "nightly", "channel")).toThrow("Only the user");
    expect(f.updates.updates.get()).toMatchObject({ automatic: true, channel: "stable" });
    expect(f.get()).toEqual({ hosts: [{ alias: "private-host" }] });
  } finally {
    f.updates.cleanup();
  }
});

test("notification/editor changes are reversible while relayed prediction model settings are refused", () => {
  const f = setup();

  try {
    f.bridge.apply("sessions.notifyNeedsYou", false, "notify");
    f.bridge.apply("sessions.editorVim", true, "vim");
    const chosen = { ...DEFAULT_PREDICTION_PREFERENCES, placement: "off" };
    expect(() =>
      f.bridge.apply(
        "prediction",
        Schema.decodeUnknownSync(Schema.Json)(chosen),
        "prediction",
        "pi"
      )
    ).toThrow("Only the user");
    expect(f.get().sessions).toMatchObject({ notifyNeedsYou: false, editorVim: true });
    expect(f.preferences.get("pi")).toEqual(DEFAULT_PREDICTION_PREFERENCES);
    expect(f.preferences.get("mac")).toEqual(DEFAULT_PREDICTION_PREFERENCES);
    f.bridge.undo("notify");
    f.bridge.undo("vim");
    expect(f.get().sessions).toEqual({});
    expect(f.preferences.get("pi")).toEqual(DEFAULT_PREDICTION_PREFERENCES);
    expect(f.get().hosts).toEqual([{ alias: "private-host" }]);
    expect(() => f.bridge.apply("sshBinary", "/tmp/ssh", "unsafe")).toThrow(
      "Unknown Client Setting"
    );
  } finally {
    f.updates.cleanup();
  }
});
