import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_PREDICTION_PREFERENCES,
  predictionRestraints,
  type PredictionPreferences,
} from "../../shared/predictionPlacement.ts";
import { KEYMAP } from "../../shared/keymap.ts";
import { readSettings, writeSettings, type Settings } from "../settings.ts";
import { PredictionSettings } from "./preferences.ts";

test("Per-Host preferences survive restart and preserve unrelated settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "polaris-prediction-settings-"));
  const path = join(dir, "settings.json");
  let settings: Settings = { theme: "light", hosts: [{ alias: "lucas-rpi" }] };

  const preferences = new PredictionSettings(
    () => settings,
    (value) => {
      settings = value;
      writeSettings({ path, settings });
    }
  );

  try {
    expect(preferences.get("local")).toEqual(DEFAULT_PREDICTION_PREFERENCES);

    const chosen = {
      ...DEFAULT_PREDICTION_PREFERENCES,
      placement: "host" as const,
      hostEndpoints: [{ kind: "openai" as const, url: "http://localhost:9000" }],
    };

    preferences.set("ssh:lucas-rpi", chosen);
    settings = readSettings(path);
    expect(preferences.get("ssh:lucas-rpi")).toEqual(chosen);
    expect(preferences.get("local")).toEqual(DEFAULT_PREDICTION_PREFERENCES);
    expect(settings.theme).toBe("light");
    expect(settings.hosts).toEqual([{ alias: "lucas-rpi" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("A v1 file migrates each Host without losing endpoints, format, enable or appearance", () => {
  const dir = mkdtempSync(join(tmpdir(), "polaris-prediction-v1-"));
  const path = join(dir, "settings.json");

  try {
    writeFileSync(
      path,
      JSON.stringify({
        theme: "light",
        predictionEnabled: true,
        predictionClientEndpoints: [{ kind: "openai", url: "http://localhost:8080" }],
        prediction: {
          mac: {
            placement: "host",
            model: "custom-fim",
            format: "suffix",
            hostEndpoints: [{ kind: "ollama", url: "http://localhost:11434" }],
          },
        },
      })
    );
    let settings = readSettings(path);

    const preferences = new PredictionSettings(
      () => settings,
      (next) => {
        writeSettings({ path, settings: next });
        settings = readSettings(path);
      }
    );

    expect(preferences.get("mac")).toEqual({
      placement: "host",
      model: "custom-fim",
      format: "suffix",
      hostEndpoints: [{ kind: "ollama", url: "http://localhost:11434" }],
      display: "full",
      aggressiveness: "balanced",
      acceptKey: "editor.prediction.accept",
      disabledLanguages: [],
      editModel: null,
      modelsDir: null,
      managedModel: null,
    });
    preferences.set("mac", { ...preferences.get("mac"), display: "subtle" });
    expect(settings).toMatchObject({
      theme: "light",
      predictionEnabled: true,
      predictionClientEndpoints: [{ kind: "openai", url: "http://localhost:8080" }],
      prediction: { mac: { display: "subtle", aggressiveness: "balanced" } },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Defaults resolve the Tab keymap binding and the balanced renderer policy", () => {
  const preferences = new PredictionSettings(
    () => ({}),
    () => {}
  );

  const defaults = preferences.get("local");

  expect(defaults).toMatchObject({
    display: "full",
    aggressiveness: "balanced",
    disabledLanguages: [],
    editModel: null,
    acceptKey: "editor.prediction.accept",
  });
  expect(KEYMAP.find((binding) => binding.id === defaults.acceptKey)?.keys).toEqual(["Tab"]);
  expect(predictionRestraints(defaults.aggressiveness)).toEqual({
    pauseMs: 150,
    jumpsOffered: true,
    jumpProbe: "spec",
    largeDeletionsOffered: true,
  });
  expect(predictionRestraints("conservative")).toEqual({
    pauseMs: 300,
    jumpsOffered: false,
    jumpProbe: "off",
    largeDeletionsOffered: false,
  });
  expect(predictionRestraints("eager")).toEqual({
    pauseMs: 75,
    jumpsOffered: true,
    jumpProbe: "reach",
    largeDeletionsOffered: true,
  });
});

test("Saved edit preferences notify after persistence, deduplicate languages and reject unknown models", () => {
  let settings: Settings = {};
  const events: Array<{ hostKey: string; preferences: PredictionPreferences }> = [];

  const preferences = new PredictionSettings(
    () => settings,
    (next) => {
      settings = next;
    },
    (hostKey, saved) => {
      expect(settings.prediction?.[hostKey]).toEqual(saved);
      events.push({ hostKey, preferences: saved });
    }
  );

  preferences.set("local", {
    ...preferences.get("local"),
    display: "subtle",
    aggressiveness: "conservative",
    disabledLanguages: ["typescript", "typescript", "python"],
    editModel: "org/Zeta-2.1-Q4_K_M.gguf",
  });
  expect(events).toEqual([
    {
      hostKey: "local",
      preferences: {
        ...DEFAULT_PREDICTION_PREFERENCES,
        display: "subtle",
        aggressiveness: "conservative",
        disabledLanguages: ["typescript", "python"],
        editModel: "org/Zeta-2.1-Q4_K_M.gguf",
      },
    },
  ]);
  expect(() =>
    preferences.set("local", { ...preferences.get("local"), editModel: "unpromptable" })
  ).toThrow();
  expect(events.length).toBe(1);
  expect(preferences.get("other").display).toBe("full");
});

test("One Client endpoint list persists independently of every Host's preferences", () => {
  const dir = mkdtempSync(join(tmpdir(), "polaris-prediction-client-"));
  const path = join(dir, "settings.json");
  let settings: Settings = {};

  const preferences = new PredictionSettings(
    () => settings,
    (value) => {
      settings = value;
      writeSettings({ path, settings });
    }
  );

  try {
    const endpoints = [{ kind: "openai" as const, url: "http://127.0.0.1:8080" }];
    preferences.setClientEndpoints(endpoints);
    preferences.set("host-a", {
      ...DEFAULT_PREDICTION_PREFERENCES,
      placement: "host",
      hostEndpoints: [{ kind: "ollama", url: "http://127.0.0.1:11434" }],
    });
    preferences.set("host-b", { ...DEFAULT_PREDICTION_PREFERENCES, placement: "off" });
    settings = readSettings(path);
    expect(preferences.getClientEndpoints()).toEqual(endpoints);
    expect(preferences.get("host-a").hostEndpoints).toEqual([
      { kind: "ollama", url: "http://127.0.0.1:11434" },
    ]);
    expect(preferences.get("host-b").hostEndpoints).toEqual([]);
    preferences.setClientEndpoints([]);
    expect(preferences.get("host-a").placement).toBe("host");
    expect(preferences.get("host-b").placement).toBe("off");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
