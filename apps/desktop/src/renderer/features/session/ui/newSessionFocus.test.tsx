import "../../../test/dom.testing.ts";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createStore } from "zustand/vanilla";
import { createCommandRegistry, type CommandRegistry } from "../../../routes/commands.ts";
import { hostModel, hostView } from "../../../routes/fixtures.testing.ts";
import { installKeyboard } from "../../../routes/keyboard.ts";
import { createNavigation, type Navigation } from "../../../routes/navigation.ts";
import { type AppState, type Connection, initialState } from "../../../store/store.ts";
import { polaris } from "../../bridge.ts";
import { createOnboarding, OnboardingProvider } from "../../onboarding/index.ts";
import { installFakeBridge } from "../../../test/bridge.testing.ts";
import { Columns } from "../../../shell/Columns.tsx";
import { shellCommands } from "../../../shell/commands.ts";
import { AppProvider } from "../../../shell/hooks.ts";

let navigation: Navigation;

let commands: CommandRegistry;

let teardown: Array<() => void> = [];

beforeEach(async () => {
  const fake = installFakeBridge();

  fake.refuse("settings.get", { code: "Unsupported", message: "not in this test" });
  fake.refuse("onboarding.found", { code: "Unsupported", message: "not in this test" });

  const store = createStore<AppState>(() => ({
    ...initialState,
    hosts: [hostView("local")],
    hostModels: { local: hostModel([{ id: "app" }]) },
  }));

  const connection: Connection = {
    store,
    openSession: () => () => undefined,
    setDensity: () => undefined,
    setAppearance: () => undefined,
  };

  navigation = createNavigation({ app: store, storage: null });
  commands = createCommandRegistry({ platform: "mac" });
  teardown = [
    commands.register(shellCommands({ connection, navigation, dark: () => false })),
    installKeyboard({ actions: navigation.actions, registry: commands }),
  ];
  act(() => navigation.actions.selectHost("local"));
  const onboarding = createOnboarding({ api: polaris(), store });

  render(
    <AppProvider value={{ connection, navigation, commands }}>
      <OnboardingProvider value={onboarding}>
        <Columns />
      </OnboardingProvider>
    </AppProvider>
  );
  // Onboarding reads its settings from the bridge.
  await act(async () => undefined);
});

afterEach(() => {
  cleanup();

  for (const off of teardown) off();
});

const prompt = () => document.querySelector<HTMLElement>('[data-testid="composer-input"]');

/** ⌘N as the window receives it, then the editor's lazy chunk and first update. */
const commandN = async () => {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "n", code: "KeyN", metaKey: true, cancelable: true })
    );
  });

  for (let i = 0; i < 20 && prompt() === null; i++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }

  await act(async () => undefined);
};

test("⌘N leaves the new session's prompt focused", async () => {
  await commandN();

  expect(document.activeElement).toBe(prompt());
});

test("⌘N on a new-session page already open focuses its prompt again", async () => {
  await commandN();
  act(() => prompt()?.blur());

  await commandN();

  expect(prompt()).not.toBeNull();
  expect(document.activeElement).toBe(prompt());
});
