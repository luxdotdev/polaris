/**
 * Every keyboard shortcut in one table: the renderer's dispatcher runs them,
 * the native menu shows them (without registering, so the renderer stays the
 * one handler), the help overlay lists them, and a test checks for conflicts.
 * Chords use Electron's accelerator syntax ("CmdOrCtrl+Shift+A").
 */

export type CommandId =
  | "view.orchestrate"
  | "view.review"
  | "view.edit"
  | "view.output"
  | "jump.open"
  | "help.shortcuts"
  | "session.new"
  | "session.next"
  | "session.previous"
  | "session.focusComposer"
  | "session.interrupt"
  | "approval.approve"
  | "approval.deny"
  | "session.archive"
  | "session.openInTerminal"
  | "theme.toggle"
  | "settings.open"
  | "settings.appearance"
  | "settings.sessions"
  | "settings.harnesses"
  | "settings.constellations"
  | "settings.usage"
  | "settings.hosts"
  | "settings.reviewer"
  | "settings.github"
  | "github.addAccount"
  | "workspace.add"
  | "review.nextTab"
  | "review.previousTab"
  | "editor.findFile"
  | "editor.inlineChat"
  | "editor.addToSession";

export type MenuName = "App" | "View" | "Go" | "Session" | "Help";

export interface KeyBinding {
  readonly id: CommandId;
  readonly title: string;
  /** Accelerators; the first is the one menus and hints show. Empty: menu or jump menu only. */
  readonly keys: ReadonlyArray<string>;
  /** Bare keys (no ⌘/⌃/⌥) never fire while typing in a field; chords do unless this is false. */
  readonly inFields?: boolean;
  /** Where the native menu lists it, if anywhere. */
  readonly menu?: MenuName;
  /** Another command on the same chord; the first enabled one runs, so they must not overlap. */
  readonly shares?: CommandId;
}

export const KEYMAP: ReadonlyArray<KeyBinding> = [
  { id: "view.orchestrate", title: "Orchestrate", keys: ["CmdOrCtrl+1"], menu: "View" },
  { id: "view.review", title: "Review", keys: ["CmdOrCtrl+2"], menu: "View" },
  { id: "view.edit", title: "Edit", keys: ["CmdOrCtrl+3"], menu: "View" },
  { id: "view.output", title: "Show or hide output", keys: ["CmdOrCtrl+Alt+B"], menu: "View" },
  { id: "jump.open", title: "Jump to…", keys: ["CmdOrCtrl+K", "K"], menu: "Go" },
  { id: "session.next", title: "Next session", keys: ["CmdOrCtrl+Alt+Down"], menu: "Go" },
  { id: "session.previous", title: "Previous session", keys: ["CmdOrCtrl+Alt+Up"], menu: "Go" },
  { id: "session.new", title: "New session", keys: ["CmdOrCtrl+N"], menu: "Session" },
  { id: "editor.findFile", title: "Go to file…", keys: ["CmdOrCtrl+P"], menu: "Go" },
  { id: "editor.inlineChat", title: "Edit or ask", keys: ["CmdOrCtrl+I"] },
  // Only with a selection in Edit; otherwise ⌘L focuses the composer.
  {
    id: "editor.addToSession",
    title: "Add to agent session",
    keys: ["CmdOrCtrl+L"],
    shares: "session.focusComposer",
  },
  {
    id: "session.focusComposer",
    title: "Focus the composer",
    keys: ["CmdOrCtrl+L"],
    menu: "Session",
  },
  { id: "session.interrupt", title: "Stop the turn", keys: ["CmdOrCtrl+."], menu: "Session" },
  { id: "approval.approve", title: "Approve", keys: ["CmdOrCtrl+Shift+A"], menu: "Session" },
  { id: "approval.deny", title: "Deny", keys: ["CmdOrCtrl+Shift+D"], menu: "Session" },
  { id: "session.openInTerminal", title: "Open in terminal", keys: [], menu: "Session" },
  { id: "session.archive", title: "Archive session", keys: [], menu: "Session" },
  { id: "theme.toggle", title: "Toggle dark and light", keys: [] },
  { id: "review.nextTab", title: "Next review tab", keys: ["CmdOrCtrl+Shift+]"], menu: "Go" },
  {
    id: "review.previousTab",
    title: "Previous review tab",
    keys: ["CmdOrCtrl+Shift+["],
    menu: "Go",
  },
  { id: "workspace.add", title: "Add workspace…", keys: ["CmdOrCtrl+O"], menu: "Go" },
  // macOS's own Settings… chord, in the app menu (DESIGN.md, Settings).
  { id: "settings.open", title: "Settings…", keys: ["CmdOrCtrl+,"], menu: "App" },
  { id: "settings.appearance", title: "Settings: Appearance", keys: [] },
  { id: "settings.sessions", title: "Settings: Sessions", keys: [] },
  { id: "settings.harnesses", title: "Settings: Harnesses", keys: [] },
  { id: "settings.constellations", title: "Settings: Constellations", keys: [] },
  { id: "settings.usage", title: "Settings: Usage", keys: [] },
  { id: "settings.hosts", title: "Settings: Hosts", keys: [] },
  { id: "settings.reviewer", title: "Settings: Reviewer", keys: [] },
  { id: "settings.github", title: "Settings: GitHub accounts", keys: [] },
  { id: "github.addAccount", title: "Add GitHub account…", keys: [] },
  {
    id: "help.shortcuts",
    title: "Keyboard shortcuts",
    keys: ["CmdOrCtrl+/", "Shift+/"],
    menu: "Help",
  },
];

/** Chords macOS, Electron or the standard menus own; nothing here may take them. */
export const RESERVED: ReadonlyArray<string> = [
  "CmdOrCtrl+Q",
  "CmdOrCtrl+W",
  "CmdOrCtrl+H",
  "CmdOrCtrl+Alt+H",
  "CmdOrCtrl+M",
  "CmdOrCtrl+C",
  "CmdOrCtrl+V",
  "CmdOrCtrl+X",
  "CmdOrCtrl+A",
  "CmdOrCtrl+Z",
  "CmdOrCtrl+Shift+Z",
  "CmdOrCtrl+`",
  "CmdOrCtrl+R",
  "CmdOrCtrl+Alt+I",
  "CmdOrCtrl+Shift+/",
  "CmdOrCtrl+Shift+3",
  "CmdOrCtrl+Shift+4",
  "CmdOrCtrl+Shift+5",
  "CmdOrCtrl+Ctrl+F",
  "CmdOrCtrl+Ctrl+Q",
  "CmdOrCtrl+Space",
  "Ctrl+Space",
  "CmdOrCtrl+Tab",
];

/** ⌃1…⌃0 and ⌥1…⌥0 pick Workspace chips or machines; they are data-driven, so outside KEYMAP. */
export const SHORTCUT_DIGIT_MODIFIERS: ReadonlyArray<string> = ["Ctrl", "Alt"];

export const bindingOf = (id: CommandId): KeyBinding | undefined => KEYMAP.find((b) => b.id === id);
