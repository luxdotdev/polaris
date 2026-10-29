import "../test/dom.testing.ts";
// The app loads its slots first; shell/commands.ts reaches them through a cycle.
import "../app/slots.tsx";
import { TooltipProvider } from "@polaris/ui";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import { createStore } from "zustand/vanilla";
import { createCommandRegistry } from "../routes/commands.ts";
import { createNavigation } from "../routes/navigation.ts";
import { type AppState, type Connection, initialState } from "../store/store.ts";
import { TitleBar } from "./TitleBar.tsx";
import { shellCommands } from "./commands.ts";
import { AppProvider } from "./hooks.ts";

afterEach(cleanup);

const page = () => within(document.body);

/** The real title bar, with the shell's commands behind ⌘1–3. */
const mount = () => {
  const store = createStore<AppState>(() => initialState);

  const connection: Connection = {
    store,
    openSession: () => () => undefined,
    setDensity: () => undefined,
    setAppearance: () => undefined,
  };

  const navigation = createNavigation({ app: store, storage: null });
  const commands = createCommandRegistry({ platform: "mac" });

  commands.register(shellCommands({ connection, navigation, dark: () => false }));
  render(
    <AppProvider value={{ connection, navigation, commands }}>
      <TooltipProvider>
        <TitleBar />
      </TooltipProvider>
    </AppProvider>
  );

  return { navigation, commands };
};

const tabs = () => page().getAllByRole("radio");

const selected = () =>
  tabs()
    .filter((tab) => tab.getAttribute("aria-checked") === "true")
    .map((tab) => tab.textContent);

test("with Settings open no mode is selected, and every tab stays enabled", () => {
  const { navigation } = mount();

  act(() => navigation.actions.setMode("review"));
  act(() => navigation.actions.openSettings());

  expect(selected()).toEqual([]);
  expect(tabs().every((tab) => !tab.hasAttribute("disabled"))).toBe(true);
});

test("⌘2 from Settings closes it and selects Review", () => {
  const { navigation, commands } = mount();

  act(() => navigation.actions.openSettings());
  act(() => {
    commands.handleKey({
      code: "Digit2",
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      typing: false,
    });
  });

  expect(navigation.store.getState().settings).toBeNull();
  expect(selected()).toEqual(["Review"]);
});

test("clicking the mode underneath Settings leaves Settings for it", () => {
  const { navigation } = mount();

  act(() => navigation.actions.openSettings());
  act(() => {
    fireEvent.click(page().getByRole("radio", { name: "Orchestrate" }));
  });

  expect(navigation.store.getState().settings).toBeNull();
  expect(selected()).toEqual(["Orchestrate"]);
});
