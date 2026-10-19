import "../../../test/dom.testing.ts";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { DEFAULT_SESSION_PREFS } from "../../../../shared/sessionPrefs.ts";
import { installFakeBridge, type FakeBridge } from "../../../test/bridge.testing.ts";
import { polaris } from "../../bridge.ts";
import { connectSettings, settingsStore } from "../store.ts";
import { TurnNotifications } from "./TurnNotifications.tsx";

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

/** happy-dom lacks `oninput`, so React watches the focused field's value on key events. */
const type = (field: HTMLInputElement, value: string) => {
  act(() => field.focus());
  fireEvent.change(field, { target: { value } });
  fireEvent.keyUp(field, { key: "0" });
};

const input = (element: HTMLElement) => {
  if (!(element instanceof HTMLInputElement)) throw new Error("not an input");

  return element;
};

const page = () => {
  const view = within(render(<TurnNotifications />).container);

  return {
    main: view.getByRole("switch", { name: "Notify when a turn finishes" }),
    longOnly: () =>
      input(view.getByRole("checkbox", { name: /^Only turns longer than \d+ minutes$/ })),
    minutes: () => input(view.getByRole("textbox", { name: "Minutes" })),
  };
};

test("the long-turns option is off until turn notifications are on", () => {
  const { main, longOnly, minutes } = page();

  expect([longOnly().disabled, minutes().disabled]).toEqual([true, true]);

  fireEvent.click(main);

  expect([longOnly().disabled, minutes().disabled]).toEqual([false, false]);
  expect(longOnly().getAttribute("aria-label")).toBe("Only turns longer than 5 minutes");
  expect(minutes().value).toBe("5");
});

test("checking it and changing the minutes saves both", () => {
  act(() =>
    settingsStore.setState({ sessions: { ...DEFAULT_SESSION_PREFS, notifyTurnEnded: true } })
  );
  const { longOnly, minutes } = page();

  fireEvent.click(longOnly());
  type(minutes(), "12");
  fireEvent.blur(minutes());

  expect(fake.sent("settings.setSessions")).toEqual([
    { patch: { notifyLongTurnsOnly: true } },
    { patch: { longTurnMinutes: 12 } },
  ]);
  expect(settingsStore.getState().sessions).toMatchObject({
    notifyLongTurnsOnly: true,
    longTurnMinutes: 12,
  });
});

test("minutes that aren't a whole number from 1 to 999 are marked and not saved", () => {
  act(() =>
    settingsStore.setState({ sessions: { ...DEFAULT_SESSION_PREFS, notifyTurnEnded: true } })
  );
  const { minutes } = page();

  for (const value of ["0", "1000", "2.5", "five"]) {
    type(minutes(), value);
    fireEvent.keyDown(minutes(), { key: "Enter" });

    expect(minutes().getAttribute("aria-invalid")).toBe("true");
  }

  expect(fake.sent("settings.setSessions")).toEqual([]);
  expect(settingsStore.getState().sessions.longTurnMinutes).toBe(5);
});
