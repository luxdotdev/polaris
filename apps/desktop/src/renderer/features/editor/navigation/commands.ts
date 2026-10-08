/**
 * The editor's language commands (DESIGN.md, Editor: Language assistance): every feature the
 * old tools row offered, as Command Palette commands, several with VS Code's keys.
 */
import type { LanguageCommand } from "../lsp/queries.ts";

export type NavigationAction =
  | LanguageCommand
  | "back"
  | "forward"
  | "hover"
  | "next-problem"
  | "previous-problem"
  | "rename-field"
  | "symbol-search";

export interface LanguageNavigationCommand {
  /** Namespaced for the palette's `contribute` ("editor.language.definition"). */
  readonly id: string;
  readonly title: string;
  readonly action: NavigationAction;
  /** CodeMirror key syntax; bound while the code has focus. */
  readonly key?: string;
  /** The shortcut as the palette shows it. */
  readonly shortcut?: string;
  /** It asks for more (a name, a query) before it acts. */
  readonly followUp?: boolean;
  /** Vim normal-mode keys that run it through the command registry (`cm/vim.ts`). */
  readonly vim?: readonly string[];
}

export const LANGUAGE_NAVIGATION: readonly LanguageNavigationCommand[] = [
  {
    id: "editor.language.definition",
    title: "Go to definition",
    action: "definition",
    key: "F12",
    shortcut: "F12",
    // gD too: the protocol has no textDocument/declaration, so declaration falls back to definition.
    vim: ["gd", "gD"],
  },
  {
    id: "editor.language.typeDefinition",
    title: "Go to type definition",
    action: "typeDefinition",
    vim: ["gy"],
  },
  {
    id: "editor.language.implementation",
    title: "Go to implementation",
    action: "implementation",
    vim: ["gi"],
  },
  {
    id: "editor.language.references",
    title: "Find references",
    action: "references",
    key: "Shift-F12",
    shortcut: "⇧F12",
    vim: ["gr"],
  },
  { id: "editor.language.hover", title: "Show hover", action: "hover", vim: ["K"] },
  {
    id: "editor.language.symbols",
    title: "Go to symbol in file",
    action: "symbols",
    key: "Mod-Shift-o",
    shortcut: "⇧⌘O",
  },
  {
    id: "editor.language.workspaceSymbols",
    title: "Go to symbol in workspace…",
    action: "symbol-search",
    key: "Mod-t",
    shortcut: "⌘T",
    followUp: true,
  },
  {
    id: "editor.language.rename",
    title: "Rename symbol…",
    action: "rename-field",
    key: "F2",
    shortcut: "F2",
    followUp: true,
  },
  {
    id: "editor.language.problems",
    title: "Show problems",
    action: "problems",
    key: "Mod-Shift-m",
    shortcut: "⇧⌘M",
  },
  // ⌘. stays "Stop the turn", so code actions have no key.
  { id: "editor.language.actions", title: "Show code actions", action: "actions" },
  { id: "editor.language.signature", title: "Show signature help", action: "signature" },
  {
    id: "editor.language.nextProblem",
    title: "Go to next problem",
    action: "next-problem",
    key: "F8",
    shortcut: "F8",
    vim: ["]d"],
  },
  {
    id: "editor.language.previousProblem",
    title: "Go to previous problem",
    action: "previous-problem",
    key: "Shift-F8",
    shortcut: "⇧F8",
    vim: ["[d"],
  },
  {
    id: "editor.language.back",
    title: "Go back",
    action: "back",
    key: "Ctrl--",
    shortcut: "⌃-",
    vim: ["<C-o>"],
  },
  {
    id: "editor.language.forward",
    title: "Go forward",
    action: "forward",
    key: "Ctrl-Shift--",
    shortcut: "⌃⇧-",
    vim: ["<C-i>"],
  },
];
