/**
 * The Editor's right-click menu as data (DESIGN.md, Menus; Paper 19–19c). Rows the file's
 * servers can't serve are left out; while a server starts, its rows dim with "Starting".
 */
import { formatChord, parseChord } from "../../../../shared/chord.ts";
import { bindingOf, type CommandId, RESERVED } from "../../../../shared/keymap.ts";
import type { LanguageViewState } from "../lsp/state.ts";
import type { FileLanguage } from "../status/store.ts";
import {
  LANGUAGE_NAVIGATION,
  type LanguageNavigationCommand,
  type NavigationAction,
  shortcutOf,
} from "../navigation/commands.ts";

/** The shape of `MenuAction` in `@polaris/ui`'s menu entries, so the list renders either way. */
export interface MenuAction {
  readonly kind: "item";
  readonly label: string;
  readonly onSelect: () => void;
  /** It asks for more before it runs; the label ends in "…". */
  readonly needsInput?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  /** Why it's disabled, in the shortcut lane. */
  readonly reason?: string | undefined;
  readonly shortcut?: string | undefined;
  readonly testId?: string | undefined;
}

export interface MenuSeparatorEntry {
  readonly kind: "separator";
}

export type MenuEntry = MenuAction | MenuSeparatorEntry;

export type MenuEntryInput = MenuEntry | null | false | undefined;

const SEPARATOR: MenuSeparatorEntry = { kind: "separator" };

/** Drops hidden entries and any separator that would lead, trail or follow another. */
export const tidyEntries = (input: ReadonlyArray<MenuEntryInput>): ReadonlyArray<MenuEntry> => {
  const out: Array<MenuEntry> = [];

  for (const entry of input) {
    if (entry === null || entry === false || entry === undefined) continue;

    if (entry.kind === "separator" && (out.length === 0 || out.at(-1)?.kind === "separator"))
      continue;
    out.push(entry);
  }

  while (out.at(-1)?.kind === "separator") out.pop();

  return out;
};

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

const chordOf = (accelerator: string | undefined) =>
  accelerator === undefined ? undefined : formatChord(parseChord(accelerator));

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
        needsInput: binding.palette !== false && binding.palette?.followUp === true,
        shortcut: chordOf(binding.keys[0]),
        testId: testIdOf(id),
      };
};

/** Cut, Copy and Paste: the standard menus own their chords (KEYMAP's RESERVED). */
const clipboardRow = (
  label: string,
  what: Clipboard,
  accelerator: string,
  input: EditorMenuInput
): MenuAction => ({
  kind: "item",
  label,
  onSelect: () => input.actions.clipboard(what),
  shortcut: chordOf(RESERVED.find((key) => key === accelerator)),
  testId: `editor-menu-${what}`,
});

const action = (label: string, onSelect: () => void, testId: string): MenuAction => ({
  kind: "item",
  label,
  onSelect,
  testId: `editor-menu-${testId}`,
});

/** The first dimmed row carries the reason; the rest just dim. */
const withStartingReason = (entries: ReadonlyArray<MenuEntry>): ReadonlyArray<MenuEntry> => {
  const first = entries.findIndex((entry) => entry.kind === "item" && entry.disabled === true);

  return entries.map((entry, index) =>
    entry.kind === "item" && entry.disabled === true
      ? { ...entry, reason: index === first ? STARTING : undefined }
      : entry
  );
};

export const editorMenuEntries = (input: EditorMenuInput): ReadonlyArray<MenuEntry> => {
  const { enabled, actions, server } = input;
  const language = (id: string) => languageRow(id, input);
  const command = (id: CommandId) => keymapRow(id, () => actions.command(id));

  return withStartingReason(
    tidyEntries([
      language("editor.language.definition"),
      language("editor.language.typeDefinition"),
      language("editor.language.implementation"),
      language("editor.language.references"),
      SEPARATOR,
      language("editor.language.rename"),
      language("editor.language.actions"),
      server.kind === "ready" && enabled("editor.format") && command("editor.format"),
      SEPARATOR,
      language("editor.language.completion"),
      language("editor.language.signature"),
      enabled("editor.markdownPreview") && command("editor.markdownPreview"),
      SEPARATOR,
      enabled("editor.inlineChat") && command("editor.inlineChat"),
      enabled("editor.inlineChat") && keymapRow("editor.addToSession", actions.addToSession),
      SEPARATOR,
      clipboardRow("Cut", "cut", "CmdOrCtrl+X", input),
      clipboardRow("Copy", "copy", "CmdOrCtrl+C", input),
      clipboardRow("Paste", "paste", "CmdOrCtrl+V", input),
      SEPARATOR,
      action("Copy path", () => actions.copyPath(false), "copy-path"),
      action("Copy relative path", () => actions.copyPath(true), "copy-relative-path"),
      action("Reveal in file tree", actions.revealInTree, "reveal-in-tree"),
      action("Open in terminal", actions.openInTerminal, "open-in-terminal"),
    ])
  );
};
