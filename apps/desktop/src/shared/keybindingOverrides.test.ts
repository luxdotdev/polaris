import { afterEach, expect, test } from "bun:test";
import { Schema } from "effect";
import { KeybindingOverrides, recordedBinding, bindingUnavailable } from "./keybindingOverrides.ts";
import { defaultKeymapFor, keymapFor } from "./keymap.ts";
import { resolveKeybindings, setKeybindingOverrides } from "./keybindingResolution.ts";
import { createCommandRegistry } from "../renderer/routes/commands.ts";

afterEach(() => setKeybindingOverrides({}));

const decode = Schema.decodeUnknownSync(KeybindingOverrides);

test("rejects unknown actions, modifiers, sequences and intercepted shortcuts", () => {
  for (const value of [
    { unknown: "CmdOrCtrl+J" },
    { "session.new": "Hyper+J" },
    { "session.new": "CmdOrCtrl+K CmdOrCtrl+J" },
    { "session.new": "Ctrl+Ctrl+J" },
    { "session.new": "CmdOrCtrl+Q" },
    { "session.new": "Ctrl+1" },
    { "session.new": "Ctrl+`" },
    { "session.new": "Escape" },
  ])
    expect(() => decode(value)).toThrow();
  expect(decode({ "session.new": null, "settings.open": "CmdOrCtrl+Shift+J" })).toEqual({
    "session.new": null,
    "settings.open": "CmdOrCtrl+Shift+J",
  });
  expect(bindingUnavailable("Alt+F4", "windows")).toContain("reserved");
});

test("an override displaces defaults, null unbinds, and reset restores all aliases", () => {
  const defaults = defaultKeymapFor("mac");

  const { bindings, conflicts } = resolveKeybindings(
    defaults,
    { "session.new": "CmdOrCtrl+P", "session.next": null },
    "mac"
  );

  expect(bindings.find((b) => b.id === "editor.findFile")?.keys).toEqual([]);
  expect(bindings.find((b) => b.id === "session.next")?.keys).toEqual([]);
  expect(conflicts).toEqual([{ id: "editor.findFile", winner: "session.new", key: "CmdOrCtrl+P" }]);
  setKeybindingOverrides({ "session.next": null });
  setKeybindingOverrides({});
  expect(keymapFor("mac").find((b) => b.id === "session.next")?.keys).toEqual([
    "CmdOrCtrl+Alt+Down",
    "Ctrl+Tab",
  ]);
});

test("last override wins, including platform-equivalent Control spellings", () => {
  const result = resolveKeybindings(
    defaultKeymapFor("windows"),
    { "session.new": "Ctrl+J", "settings.open": "CmdOrCtrl+J" },
    "windows"
  );

  expect(result.bindings.find((b) => b.id === "session.new")?.keys).toEqual([]);
  expect(result.conflicts).toContainEqual({
    id: "session.new",
    winner: "settings.open",
    key: "Ctrl+J",
  });
});

test("an existing registry dispatches and labels changes without being recreated", () => {
  const registry = createCommandRegistry({ platform: "mac" });
  let ran = "";
  registry.register({
    "settings.open": {
      run: () => {
        ran = "settings";
      },
    },
    "session.new": {
      run: () => {
        ran = "session";
      },
    },
  });

  const press = (code: string) =>
    registry.handleKey({
      code,
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      typing: false,
    });

  setKeybindingOverrides({ "settings.open": "CmdOrCtrl+N" });
  expect(press("KeyN")).toBe(true);
  expect(ran).toBe("settings");
  expect(press("Comma")).toBe(false);
  expect(registry.palette().find((b) => b.id === "settings.open")?.shortcut).toBe("⌘N");
  setKeybindingOverrides({ "settings.open": null });
  expect(press("Comma")).toBe(false);
  setKeybindingOverrides({});
  expect(press("Comma")).toBe(true);
});

test("recording uses physical keys even with Option and ignores modifier-only presses", () => {
  const event = { code: "KeyJ", metaKey: true, ctrlKey: false, altKey: true, shiftKey: false };
  expect(recordedBinding(event, "mac")).toBe("CmdOrCtrl+Alt+J");
  expect(recordedBinding({ ...event, code: "AltLeft" }, "mac")).toBeNull();
  expect(recordedBinding({ ...event, code: "Semicolon" }, "mac")).toBe("CmdOrCtrl+Alt+;");
});
