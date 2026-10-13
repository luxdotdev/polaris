/**
 * The Editor's right-click menu as data (DESIGN.md, Menus; Paper 19–19c). Rows the file's
 * servers can't serve are left out; while a server starts, its rows dim with "Starting".
 */
import { MENU_SEPARATOR_ENTRY, type MenuAction, type MenuEntry, tidyEntries } from "@polaris/ui";
import { acceleratorLabel, currentKeyPlatform } from "../../../../shared/chord.ts";
import { bindingOf, chordOf, type CommandId, EDIT_CHORDS } from "../../../../shared/keymap.ts";
import type { LanguageViewState } from "../lsp/state.ts";
import type { FileLanguage } from "../status/store.ts";
import {
  LANGUAGE_NAVIGATION,
  type LanguageNavigationCommand,
  type NavigationAction,
  shortcutOf,
} from "../navigation/commands.ts";

export type { MenuAction, MenuEntry } from "@polaris/ui";

/** What the file's language servers can do right now. */
export type ServerState =
  | { readonly kind: "none" }
  | { readonly kind: "starting" }
  | { readonly kind: "ready"; readonly methods: ReadonlySet<string> };

/** Ready once a server serves the file; starting while discovery found one that isn't yet. */
export const serverStateOf = (
  language: Pick<LanguageViewState, "status" | "methods"> | undefined,
  status:
    | { readonly phase: FileLanguage["phase"]; readonly providers: ReadonlyArray<unknown> }
    | undefined
): ServerState => {
  if (language?.status === "ready") return { kind: "ready", methods: new Set(language.methods) };

  return status?.phase === "discovered" && status.providers.length > 0
    ? { kind: "starting" }
    : { kind: "none" };
};

export type Clipboard = "cut" | "copy" | "paste";

export interface EditorMenuActions {
  readonly navigate: (action: NavigationAction) => void;
  /** Runs a KEYMAP command through the registry. */
  readonly command: (id: CommandId) => void;
  /** The selection, or the line under the click, to the current Agent Session. */
  readonly addToSession: () => void;
  readonly clipboard: (what: Clipboard) => void;
  readonly copyPath: (relative: boolean) => void;
  readonly revealInTree: () => void;
  readonly openInTerminal: () => void;
}

export interface EditorMenuInput {
  readonly server: ServerState;
  /** Whether a KEYMAP command can run now (the registry's `enabled`). */
  readonly enabled: (id: CommandId) => boolean;
  readonly actions: EditorMenuActions;
  /** Reveal in Finder, on this Mac's Host only (`revealInFinderEntry`). */
  readonly finder: MenuAction | null;
}

/** The LSP method each server row needs. */
const METHODS: Partial<Record<NavigationAction, string>> = {
  definition: "textDocument/definition",
  typeDefinition: "textDocument/typeDefinition",
  implementation: "textDocument/implementation",
  references: "textDocument/references",
  "rename-field": "textDocument/rename",
  actions: "textDocument/codeAction",
  "signature-help": "textDocument/signatureHelp",
};

/** Shown dimmed while a server starts, before its methods are known (Paper 19c). */
const WHILE_STARTING: ReadonlySet<string> = new Set([
  "editor.language.definition",
  "editor.language.references",
  "editor.language.rename",
]);

const STARTING = "Starting";

const commandOf = (id: string): LanguageNavigationCommand => {
  const found = LANGUAGE_NAVIGATION.find((command) => command.id === id);

  if (found === undefined) throw new Error(`no language command ${id}`);

  return found;
};

const testIdOf = (id: string) => `editor-menu-${id.split(".").at(-1) ?? id}`;

const languageRow = (id: string, { server, actions }: EditorMenuInput): MenuAction | null => {
  const command = commandOf(id);
  const shortcut = shortcutOf(command);

  const row: MenuAction = {
    kind: "item",
    label: command.title,
    onSelect: () => actions.navigate(command.action),
    needsInput: command.followUp === true,
    shortcut: shortcut === "" ? undefined : shortcut,
    testId: testIdOf(id),
  };

  if (command.anyFile === true) return row;

  if (server.kind === "starting") return WHILE_STARTING.has(id) ? { ...row, disabled: true } : null;

  const method = METHODS[command.action];

  return server.kind === "ready" && method !== undefined && server.methods.has(method) ? row : null;
};

const keymapRow = (id: CommandId, run: () => void): MenuAction | null => {
  const binding = bindingOf(id);

  return binding === undefined
    ? null
    : {
        kind: "item",
        label: binding.title,
        onSelect: run,
        needsInput: binding.needsInput === true,
        shortcut: acceleratorLabel(chordOf(id, currentKeyPlatform())),
        testId: testIdOf(id),
      };
};

/** Cut, Copy and Paste: the native Edit menu owns their chords (EDIT_CHORDS). */
const clipboardRow = (label: string, what: Clipboard, input: EditorMenuInput): MenuAction => ({
  kind: "item",
  label,
  onSelect: () => input.actions.clipboard(what),
  shortcut: acceleratorLabel(EDIT_CHORDS[what]),
  testId: `editor-menu-${what}`,
});

const action = (label: string, onSelect: () => void, testId: string): MenuAction => ({
  kind: "item",
  label,
  onSelect,
  testId: `editor-menu-${testId}`,
});

/** The first dimmed row carries the reason; the rest just dim, without their chords. */
const withStartingReason = (entries: ReadonlyArray<MenuEntry>): ReadonlyArray<MenuEntry> => {
  const first = entries.findIndex((entry) => entry.kind === "item" && entry.disabled === true);

  return entries.map((entry, index) =>
    entry.kind === "item" && entry.disabled === true
      ? { ...entry, reason: index === first ? STARTING : undefined, shortcut: undefined }
      : entry
  );
};

export const editorMenuEntries = (input: EditorMenuInput): ReadonlyArray<MenuEntry> => {
  const { enabled, actions, server, finder } = input;
  const language = (id: string) => languageRow(id, input);
  const command = (id: CommandId) => keymapRow(id, () => actions.command(id));

  return withStartingReason(
    tidyEntries([
      language("editor.language.definition"),
      language("editor.language.typeDefinition"),
      language("editor.language.implementation"),
      language("editor.language.references"),
      MENU_SEPARATOR_ENTRY,
      language("editor.language.rename"),
      language("editor.language.actions"),
      server.kind === "ready" && enabled("editor.format") && command("editor.format"),
      MENU_SEPARATOR_ENTRY,
      language("editor.language.completion"),
      language("editor.language.signature"),
      enabled("editor.markdownPreview") && command("editor.markdownPreview"),
      MENU_SEPARATOR_ENTRY,
      enabled("editor.inlineChat") && command("editor.inlineChat"),
      enabled("editor.inlineChat") && keymapRow("editor.addToSession", actions.addToSession),
      MENU_SEPARATOR_ENTRY,
      clipboardRow("Cut", "cut", input),
      clipboardRow("Copy", "copy", input),
      clipboardRow("Paste", "paste", input),
      MENU_SEPARATOR_ENTRY,
      action("Copy path", () => actions.copyPath(false), "copy-path"),
      action("Copy relative path", () => actions.copyPath(true), "copy-relative-path"),
      action("Reveal in file tree", actions.revealInTree, "reveal-in-tree"),
      finder,
      action("Open in terminal", actions.openInTerminal, "open-in-terminal"),
    ])
  );
};
