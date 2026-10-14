import "../../../test/dom.testing.ts";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createStore } from "zustand/vanilla";
import { createCommandRegistry, type CommandRegistry } from "../../../routes/commands.ts";
import { createNavigation, type Navigation } from "../../../routes/navigation.ts";
import { AppProvider } from "../../../shell/hooks.ts";
import { type AppState, type Connection, initialState } from "../../../store/store.ts";
import { installPalette, paletteStore } from "../store.ts";
import { useNav } from "../../../shell/hooks.ts";
import { PaletteBody } from "./Palette.tsx";

let commands: CommandRegistry;

let navigation: Navigation;

let ran: Array<string>;

let uninstall: () => void;

let trust: "trust.trusted" | "trust.declined" = "trust.trusted";

const memory = new Map<string, string>();

const storage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
};

/** The card without its Radix dialog, whose portal depends on module load order under bun test. */
const Card = () => {
  const open = useNav((s) => s.paletteOpen);

  return open ? <PaletteBody onClose={() => navigation.actions.setPaletteOpen(false)} /> : null;
};

const mount = () => {
  const store = createStore<AppState>(() => initialState);

  const connection: Connection = {
    store,
    openSession: () => () => undefined,
    setDensity: () => undefined,
    setAppearance: () => undefined,
  };

  return render(
    <AppProvider value={{ connection, navigation, commands }}>
      <Card />
    </AppProvider>
  );
};

const open = () => act(() => navigation.actions.setPaletteOpen(true));

const input = () => document.querySelector<HTMLInputElement>('[data-testid="palette-input"]');

const rows = () =>
  [...document.querySelectorAll<HTMLElement>('[data-testid="palette-row"]')].map((r) => ({
    id: r.dataset.command,
    text: r.textContent,
    selected: r.dataset.selected === "true",
  }));

/** Types into the field the way React sees it: the native value setter, then an input event. */
const type = (value: string) => {
  const field = input();

  if (field === null) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
  // React reads the change on input or, when it found no `oninput` as it loaded, on keyup.
  fireEvent.input(field);
  fireEvent.keyUp(field, { key: value.at(-1) ?? "" });
};

const press = (key: string, shiftKey = false) => {
  const field = input();

  if (field !== null) fireEvent.keyDown(field, { key, shiftKey });
};

beforeEach(() => {
  memory.clear();
  ran = [];
  commands = createCommandRegistry({ platform: "mac" });
  navigation = createNavigation({ app: createStore<AppState>(() => initialState), storage: null });
  uninstall = installPalette({ commands, actions: navigation.actions, storage });

  commands.provide(() => ({
    keys: ["workspace", "editor.file", "language.server", "trust.known", trust],
    values: {
      workspace: "polaris",
      language: "TypeScript",
      file: "reconnect.ts",
      trustSubject: "polaris",
    },
  }));

  const record = (id: string) => ({ run: () => void ran.push(id) });

  commands.register({
    "language.restart": record("language.restart"),
    "language.restartAll": record("language.restartAll"),
    "trust.revoke": record("trust.revoke"),
    "theme.toggle": record("theme.toggle"),
    "trust.grant": {
      followUp: () => ({
        title: "Run polaris's own TypeScript?",
        note: "This workspace has TypeScript 7.0.2.",
        choices: [
          { id: "trust", title: "Trust polaris", run: () => void ran.push("trust") },
          { id: "never", title: "Never", disabled: true, detail: "Not offered", run: () => {} },
        ],
      }),
      enabled: () => true,
    },
  });
});

afterEach(() => {
  uninstall();
  cleanup();
  paletteStore.setState({ recent: [], followUp: null });
  trust = "trust.trusted";
});

describe("Command Palette", () => {
  test("opens on its field with the groups labelled and the count in the footer", () => {
    mount();
    open();

    expect(document.activeElement).toBe(input());
    expect(input()?.getAttribute("role")).toBe("combobox");
    expect(input()?.placeholder).toBe("Run a command");

    const headings = [...document.querySelectorAll("[data-palette-heading]")].map(
      (h) => h.textContent
    );

    expect(headings).toEqual(["TypeScript · reconnect.ts", "Workspace · polaris", "Polaris"]);
    expect(rows()[0]).toEqual({
      id: "language.restart",
      text: "Restart TypeScript server⌥⌘R",
      selected: true,
    });
    expect(document.querySelector('[data-testid="palette-count"]')?.textContent).toBe("4 commands");
    expect(
      document.querySelector('[data-command="language.restart"]')?.getAttribute("aria-keyshortcuts")
    ).toBe("Meta+Alt+R");
  });

  test("↵ runs the highlighted command, closes, and it leads Recent next time", () => {
    const { unmount } = mount();

    open();
    press("ArrowDown");
    press("ArrowDown");
    expect(rows().find((r) => r.selected)?.id).toBe("trust.revoke");
    act(() => press("Enter"));

    expect(ran).toEqual(["trust.revoke"]);
    expect(navigation.store.getState().paletteOpen).toBe(false);
    expect(JSON.parse(memory.get("polaris.palette.recent.v1") ?? "[]")).toEqual(["trust.revoke"]);

    unmount();
    mount();
    open();
    expect(document.querySelector("[data-palette-heading]")?.textContent).toBe("Recent");
    expect(rows()[0]?.id).toBe("trust.revoke");
  });

  test("Tab and ⇧Tab move between groups", () => {
    mount();
    open();
    press("Tab");
    expect(rows().find((r) => r.selected)?.id).toBe("language.restartAll");
    press("Tab");
    expect(rows().find((r) => r.selected)?.id).toBe("theme.toggle");
    press("Tab", true);
    expect(rows().find((r) => r.selected)?.id).toBe("language.restartAll");
  });

  test("typing ranks and filters; nothing matching says so", () => {
    mount();
    open();
    act(() => type("theme"));
    expect(rows().map((r) => r.id)).toEqual(["theme.toggle"]);
    expect(document.querySelector('[data-testid="palette-count"]')?.textContent).toBe("1 command");

    act(() => type("zzzz"));
    expect(document.body.textContent).toContain("Nothing matches");
  });

  test("a '…' command asks its follow-up in place; ⌫ goes back; a disabled choice is skipped", () => {
    trust = "trust.declined";
    mount();
    open();
    act(() => type("trust polaris"));
    expect(rows()[0]?.text).toBe("Trust polaris…");
    act(() => press("Enter"));

    expect(navigation.store.getState().paletteOpen).toBe(true);
    expect(input()?.placeholder).toBe("Run polaris's own TypeScript?");
    expect(document.body.textContent).toContain("This workspace has TypeScript 7.0.2.");
    expect(rows().map((r) => r.id)).toEqual(["trust", "never"]);

    press("ArrowDown");
    expect(rows().find((r) => r.selected)?.id).toBe("trust");

    act(() => press("Backspace"));
    expect(input()?.placeholder).toBe("Run a command");

    act(() => {
      void commands.run("trust.grant");
    });
    act(() => press("Enter"));
    expect(ran).toEqual(["trust"]);
    expect(navigation.store.getState().paletteOpen).toBe(false);
  });

  test("a follow-up command run from elsewhere opens the palette at its question", () => {
    trust = "trust.declined";
    mount();
    act(() => {
      void commands.run("trust.grant");
    });
    expect(navigation.store.getState().paletteOpen).toBe(true);
    expect(input()?.placeholder).toBe("Run polaris's own TypeScript?");
  });
});
