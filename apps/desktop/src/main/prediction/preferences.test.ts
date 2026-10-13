import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PREDICTION_PREFERENCES } from "../../shared/predictionPlacement.ts";
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
