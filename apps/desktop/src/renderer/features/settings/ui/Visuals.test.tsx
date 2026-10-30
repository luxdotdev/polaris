import "../../../test/dom.testing.ts";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { DEFAULT_SESSION_PREFS } from "../../../../shared/sessionPrefs.ts";
import { installFakeBridge, type FakeBridge } from "../../../test/bridge.testing.ts";
import { polaris } from "../../bridge.ts";
import { connectSettings, settingsStore } from "../store.ts";
import { syncHostVisuals } from "../visualsSync.ts";
import { Visuals } from "./Visuals.tsx";

let fake: FakeBridge;

let disconnect: () => void;

beforeEach(() => {
  fake = installFakeBridge();
  fake.refuse("settings.get", { code: "Unsupported", message: "not in this test" });
  disconnect = connectSettings(polaris());
  settingsStore.setState({ sessions: DEFAULT_SESSION_PREFS });
});

afterEach(() => {
  cleanup();
  disconnect();
});

test("rich is chosen by default, and choosing off saves it", () => {
  const view = within(render(<Visuals />).container);
  const radio = (name: RegExp) => view.getByRole<HTMLInputElement>("radio", { name });

  expect(radio(/^Rich/).checked).toBe(true);

  fireEvent.click(radio(/^Off/));

  expect(fake.sent("settings.setSessions")).toEqual([{ patch: { visuals: "off" } }]);
  expect(radio(/^Off/).checked).toBe(true);
});

test("a host is written only when its level differs", async () => {
  fake.answerOk("sessions.visuals", { level: "rich" });
  fake.answerOk("sessions.setVisuals", null);

  expect(await syncHostVisuals("mac", "rich")).toBe(true);
  expect(fake.sent("sessions.setVisuals")).toEqual([]);

  expect(await syncHostVisuals("mac", "off")).toBe(true);
  expect(fake.sent("sessions.setVisuals")).toEqual([
    { hostKey: "mac", settings: { level: "off" } },
  ]);
});

test("a refused write reports that the host doesn't hold the level", async () => {
  fake.answerOk("sessions.visuals", { level: "rich" });
  fake.refuse("sessions.setVisuals", { code: "Unsupported", message: "old daemon" });

  expect(await syncHostVisuals("pi", "simple")).toBe(false);
});
