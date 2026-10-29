import "../../../test/dom.testing.ts";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { installFakeBridge, type FakeBridge } from "../../../test/bridge.testing.ts";
import { polaris } from "../../bridge.ts";
import { connectSettings, DEFAULT_APPEARANCE, settingsStore } from "../store.ts";
import { AppearancePage } from "./AppearancePage.tsx";

let fake: FakeBridge;

let disconnect: () => void;

beforeEach(() => {
  fake = installFakeBridge();
  fake.refuse("settings.get", { code: "Unsupported", message: "not in this test" });
  disconnect = connectSettings(polaris());
  settingsStore.setState({ appearance: DEFAULT_APPEARANCE });
});

afterEach(() => {
  cleanup();
  disconnect();
});

const cards = () => {
  const group = within(render(<AppearancePage />).container).getByRole("radiogroup", {
    name: "Dark theme",
  });

  return {
    moonlit: within(group).getByRole("radio", { name: "Moonlit" }),
    midnight: within(group).getByRole("radio", { name: "Midnight" }),
  };
};

test("a dark theme card switches the dark theme and saves it", () => {
  const { moonlit, midnight } = cards();

  fireEvent.click(midnight);

  expect(settingsStore.getState().appearance.darkTheme).toBe("midnight");
  expect(fake.sent("settings.setAppearance")).toEqual([{ patch: { darkTheme: "midnight" } }]);
  expect([moonlit.getAttribute("aria-checked"), midnight.getAttribute("aria-checked")]).toEqual([
    "false",
    "true",
  ]);
});

test("each card draws its own sky, whichever dark theme the app is in", () => {
  settingsStore.setState({ appearance: { ...DEFAULT_APPEARANCE, darkTheme: "midnight" } });
  const { moonlit, midnight } = cards();

  const sky = (card: HTMLElement) => card.querySelector("[data-theme]");

  expect(sky(moonlit)?.getAttribute("data-theme-dark")).toBe("moonlit");
  expect(sky(midnight)?.getAttribute("data-theme-dark")).toBe("midnight");
  expect(sky(moonlit)?.getAttribute("data-theme")).toBe("dark");
});
