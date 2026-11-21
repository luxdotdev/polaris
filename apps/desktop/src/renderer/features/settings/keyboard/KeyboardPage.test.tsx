import "../../../test/dom.testing.ts";
import { act, cleanup, fireEvent, render, within, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { installFakeBridge, type FakeBridge } from "../../../test/bridge.testing.ts";
import {
  getKeybindingOverrides,
  setKeybindingOverrides,
} from "../../../../shared/keybindingResolution.ts";
import { createStore } from "zustand/vanilla";
import { initialState } from "../../../store/store.ts";
import { createNavigation } from "../../../routes/navigation.ts";
import { installKeyboard } from "../../../routes/keyboard.ts";
import { createCommandRegistry } from "../../../routes/commands.ts";
import { polaris } from "../../bridge.ts";
import type { AppEvent } from "../../../../shared/api.ts";
import { connectSettings, settingsStore, setKeybindings } from "../store.ts";
import { KeyboardPage } from "./KeyboardPage.tsx";

const screen = () => within(document.body);

let fake: FakeBridge;

let disconnect: () => void;

beforeEach(() => {
  fake = installFakeBridge();
  fake.refuse("settings.get", { code: "Unsupported", message: "test" });
  fake.answerOk("clientSettings.set", null);
  disconnect = connectSettings(polaris());
  settingsStore.setState({ keybindings: {} });
  setKeybindingOverrides({});
});

afterEach(() => {
  cleanup();
  disconnect();
  setKeybindingOverrides({});
});

const search = (value: string) => {
  const input = screen().getByLabelText<HTMLInputElement>("Find an action");
  act(() => input.focus());
  fireEvent.change(input, { target: { value } });
  fireEvent.keyUp(input, { key: "a" });
};

const record = async (code = "KeyN") => {
  await act(async () => {
    fireEvent.click(screen().getByLabelText("Rebind Settings…"));
  });
  fireEvent.keyDown(screen().getByLabelText("Record shortcut"), { key: "n", code, metaKey: true });
};

test("record, conflict, unbind and reset update the running registry and persist through Client Settings", async () => {
  const registry = createCommandRegistry({ platform: "mac" });
  let opened = 0;
  registry.register({ "settings.open": { run: () => opened++ } });
  render(<KeyboardPage />);
  search("Settings…");
  await record();
  expect(screen().getByText(/Takes this shortcut from New session/)).not.toBeNull();
  await act(async () => {
    fireEvent.click(screen().getByText("Save shortcut"));
  });
  await waitFor(() => expect(document.querySelector("[role=dialog]")).toBeNull());
  expect(getKeybindingOverrides()).toEqual({ "settings.open": "CmdOrCtrl+N" });
  expect(fake.sent("clientSettings.set")).toEqual([
    { key: "keybindings", value: { "settings.open": "CmdOrCtrl+N" } },
  ]);
  search("New session");
  expect(screen().getAllByText(/Conflicting: ⌘N is assigned to Settings/).length).toBeGreaterThan(
    0
  );
  search("Settings…");
  expect(
    registry.handleKey({
      code: "KeyN",
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      typing: false,
    })
  ).toBe(true);
  expect(opened).toBe(1);
  await act(async () => {
    fireEvent.click(screen().getByLabelText("Unbind Settings…"));
  });
  await waitFor(() => expect(getKeybindingOverrides()).toEqual({ "settings.open": null }));
  expect(registry.palette().find((b) => b.id === "settings.open")?.shortcut).toBe("");
  await act(async () => {
    fireEvent.click(screen().getByLabelText("Reset Settings…"));
  });
  await waitFor(() =>
    expect(registry.palette().find((b) => b.id === "settings.open")?.shortcut).toBe("⌘,")
  );
});

test("reserved shortcuts and cancelling never write; a failed save keeps the prior binding", async () => {
  render(<KeyboardPage />);
  search("Settings…");
  await record("KeyQ");
  expect(screen().getByText(/shortcut is reserved/)).not.toBeNull();
  expect(screen().getByText("Save shortcut").hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen().getByText("Cancel"));
  expect(fake.sent("clientSettings.set")).toEqual([]);
  fake.refuse("clientSettings.set", { code: "WriteFailed", message: "disk full" });
  await record();
  await act(async () => {
    fireEvent.click(screen().getByText("Save shortcut"));
  });
  await waitFor(() => expect(screen().getByText("disk full")).not.toBeNull());
  expect(getKeybindingOverrides()).toEqual({});
  expect(screen().getByRole("dialog")).not.toBeNull();
});

test("reset all restores default bindings", async () => {
  settingsStore.setState({ keybindings: { "settings.open": null, "session.new": null } });
  setKeybindingOverrides(settingsStore.getState().keybindings);
  render(<KeyboardPage />);
  fireEvent.click(screen().getByText("Reset all"));
  await waitFor(() => expect(getKeybindingOverrides()).toEqual({}));
  expect(screen().getByLabelText("Rebind New session").textContent).toBe("⌘N");
});

test("agent updates reach the running registry and a delayed save response cannot revert them", async () => {
  let emit = (_event: AppEvent): void => undefined;
  disconnect();
  disconnect = connectSettings({
    ...polaris(),
    onAppEvent: (listener) => {
      emit = listener;

      return () => undefined;
    },
  });
  const pending = Promise.withResolvers<{ readonly ok: true; readonly value: null }>();
  fake.answer("clientSettings.set", () => pending.promise);
  const saving = setKeybindings({ "settings.open": "CmdOrCtrl+J" });
  const registry = createCommandRegistry({ platform: "mac" });
  registry.register({ "settings.open": { run: () => undefined } });
  emit({ kind: "keybindings", keybindings: { "settings.open": "CmdOrCtrl+Shift+U" } });
  pending.resolve({ ok: true, value: null });
  expect(await saving).toBeNull();
  expect(settingsStore.getState().keybindings).toEqual({ "settings.open": "CmdOrCtrl+Shift+U" });
  expect(registry.palette().find((b) => b.id === "settings.open")?.shortcut).toBe("⇧⌘U");
});

test("changed shortcuts run before nested editor handlers, and recording never dispatches them", () => {
  const registry = createCommandRegistry({ platform: "mac" });
  let opened = 0;
  let nested = 0;
  registry.register({ "settings.open": { run: () => opened++ } });
  const navigation = createNavigation({ app: createStore(() => initialState), storage: null });
  const stop = installKeyboard({ registry, actions: navigation.actions });
  const input = document.createElement("input");
  input.addEventListener("keydown", (event) => {
    nested++;
    event.stopPropagation();
  });
  document.body.append(input);
  setKeybindingOverrides({ "settings.open": "CmdOrCtrl+J" });

  try {
    fireEvent.keyDown(input, { key: "j", code: "KeyJ", metaKey: true });
    expect(opened).toBe(1);
    expect(nested).toBe(0);
    input.setAttribute("data-keybinding-recorder", "");
    fireEvent.keyDown(input, { key: "j", code: "KeyJ", metaKey: true });
    expect(opened).toBe(1);
    expect(nested).toBe(1);
  } finally {
    stop();
    input.remove();
  }
});
