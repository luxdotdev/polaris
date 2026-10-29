import "../../../test/dom.testing.ts";
import { TooltipProvider } from "@polaris/ui";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import { createStore } from "zustand/vanilla";
import { createCommandRegistry } from "../../../routes/commands.ts";
import { createNavigation } from "../../../routes/navigation.ts";
import { AppProvider } from "../../../shell/hooks.ts";
import { TitleBar } from "../../../shell/TitleBar.tsx";
import { type AppState, type Connection, initialState } from "../../../store/store.ts";
import { HOSTS, MODELS } from "../preview/fixtures.ts";

afterEach(cleanup);

// Bound per call: `screen` binds to the document at import, before the DOM preload runs.
const page = () => within(document.body);

/** The real title bar over the preview's inbox: an approval, a question and three others. */
const mount = () => {
  const store = createStore<AppState>(() => ({
    ...initialState,
    hosts: HOSTS,
    hostModels: MODELS,
  }));

  const connection: Connection = {
    store,
    openSession: () => () => undefined,
    setDensity: () => undefined,
    setAppearance: () => undefined,
  };

  const navigation = createNavigation({ app: store, storage: null });
  const commands = createCommandRegistry({ platform: "mac" });

  render(
    <AppProvider value={{ connection, navigation, commands }}>
      <TooltipProvider>
        <TitleBar />
      </TooltipProvider>
    </AppProvider>
  );

  return navigation;
};

const press = (key: string) =>
  act(() => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key });
  });

const openByKeyboard = () => {
  const trigger = page().getByTestId("needs-you-trigger");

  act(() => trigger.focus());
  press("Enter");

  return trigger;
};

const rowOf = (el: Element | null) => el?.closest("[data-row]")?.textContent ?? "";

test("clicking the badge opens the inbox without switching modes", () => {
  const navigation = mount();

  act(() => navigation.actions.setMode("review"));
  act(() => {
    fireEvent.click(page().getByTestId("needs-you-trigger"));
  });

  expect(page().getByTestId("needs-you-inbox").textContent).toContain("Needs you");
  expect(navigation.store.getState().mode).toBe("review");
});

test("the arrows reach every item in the inbox and each item's actions", () => {
  mount();
  openByKeyboard();
  const rows = page().getByTestId("needs-you-inbox").querySelectorAll("[data-row]");
  const visited = [rowOf(document.activeElement)];

  for (let i = 1; i < rows.length; i++) {
    press("ArrowDown");
    visited.push(rowOf(document.activeElement));
  }

  expect(visited).toEqual([...rows].map((row) => row.textContent ?? ""));

  // Back to the approval, then across to its Deny.
  for (let i = 1; i < rows.length; i++) press("ArrowUp");
  expect(document.activeElement?.textContent).toBe("Approve");
  press("ArrowRight");
  expect(document.activeElement?.textContent).toBe("Deny");
});

test("Escape closes the inbox and returns focus to the badge", async () => {
  mount();
  const trigger = openByKeyboard();

  expect(page().getByTestId("needs-you-inbox").contains(document.activeElement)).toBe(true);
  press("Escape");
  // The focus scope hands focus back on the next task.
  await act(() => Bun.sleep(1));

  expect(page().queryByTestId("needs-you-inbox")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
