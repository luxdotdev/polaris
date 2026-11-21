import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clientSettingsSnapshot, decodeClientSetting } from "../shared/clientSettings.ts";
import type { AppEvent } from "../shared/api.ts";
import { createClientSettingsBridge } from "./clientSettings.ts";
import { readSettings, Settings, writeSettings } from "./settings.ts";
import { Schema } from "effect";

const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), "pl-client-settings-"));
  const path = join(dir, "settings.json");
  const events: AppEvent[] = [];

  const bridge = createClientSettingsBridge({
    get: () => {
      const { prediction: _prediction, ...rest } = readSettings(path);

      return rest;
    },
    apply: (key, value) => {
      const next = { ...readSettings(path), [key]: value };

      if (value === undefined) Reflect.deleteProperty(next, key);
      writeSettings({ path, settings: Schema.decodeUnknownSync(Settings)(next) });
    },
    publish: (event) => events.push(event),
  });

  return { bridge, path, events, dispose: () => rmSync(dir, { recursive: true, force: true }) };
};

test("an agent change is persisted with an Undo notice; Undo restores an unset default", () => {
  const f = fixture();

  try {
    f.bridge.apply("theme", "light", "request-1");
    expect(readSettings(f.path).theme).toBe("light");
    expect(f.events).toEqual([
      {
        kind: "client-settings-changed",
        requestId: "request-1",
        key: "theme",
        value: "light",
        previousValue: "system",
      },
    ]);
    f.bridge.undo("request-1");
    expect(readSettings(f.path)).toEqual({});
  } finally {
    f.dispose();
  }
});

test("invalid and unknown settings write nothing, and an older Undo preserves a newer edit", () => {
  const f = fixture();

  try {
    expect(() => f.bridge.apply("theme", "sepia", "bad")).toThrow();
    expect(() => f.bridge.apply("hosts", [], "bad")).toThrow("Unknown Client Setting");
    expect(readSettings(f.path)).toEqual({});
    expect(f.events).toEqual([]);
    f.bridge.apply("theme", "dark", "first");
    f.bridge.apply("theme", "light", "second");
    expect(() => f.bridge.undo("first")).toThrow("changed again");
    expect(readSettings(f.path).theme).toBe("light");
    f.bridge.undo("second");
    expect(readSettings(f.path).theme).toBe("dark");
  } finally {
    f.dispose();
  }
});

test("every published Client Setting has a description, JSON Schema type and valid default", () => {
  const settings = clientSettingsSnapshot({});
  expect(settings.map((s) => s.key)).not.toContain("hosts");

  for (const s of settings) {
    expect(s.description.length).toBeGreaterThan(0);
    expect(s.type).toHaveProperty("schema");
    expect(decodeClientSetting(s.key, s.default)).toEqual(s.default);
    expect(s.value).toEqual(s.default);
  }
});
