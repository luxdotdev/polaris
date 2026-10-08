/**
 * Every command in one table: the renderer's dispatcher runs their shortcuts,
 * the native menu shows them (without registering, so the renderer stays the
 * one handler), the help overlay and the Command Palette list them, and a test
 * checks for conflicts. Chords use Electron's accelerator syntax ("CmdOrCtrl+Shift+A").
 * Features add commands of their own at run time (`routes/commands.ts`, `contribute`).
 */
import { Predicate } from "effect";

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
  | "settings.about"
  | "updates.check"
  | "updates.restart"
  | "settings.appearance"
  | "settings.sessions"
  | "settings.editor"
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
  | "editor.findInWorkspace"
  | "editor.inlineChat"
  | "editor.addToSession"
  | "editor.markdownPreview"
  | "editor.save"
  | "editor.nextTab"
  | "editor.previousTab"
  | "tab.close"
  | "tab.closeOthers"
  | "window.close"
  | "palette.open"
  | "editor.format"
  | "language.restart"
  | "language.restartAll"
  | "language.showLog"
  | "typescript.selectVersion"
  | "python.selectInterpreter"
  | "sql.selectDialect"
  | "trust.grant"
  | "trust.revoke"
  | "trust.askAgain";

export type MenuName = "App" | "File" | "View" | "Go" | "Session" | "Help";

/** The palette's groups (DESIGN.md, Command Palette): the focused file's, the Workspace's, the app's. */
export type CommandGroup = "file" | "workspace" | "app";

/** Facts about the moment that features put in the command context; `when` reads them. */
export const CONTEXT_KEYS = [
  /** A file is open and focused in Edit. */
  "editor.file",
  /** The focused file's Language Integration has a language server. */
  "language.server",
  "language.formatter",
  "language.typescript",
  /** A Python file whose checkout the Daemon has named, so its interpreters can be listed. */
  "language.python",
  /** A SQL file whose checkout the Daemon has named, so its dialect can be read. */
  "language.sql",
  /** Something can open the language server log (`features/editor/intents/languageLog.ts`). */
  "language.log",
  "workspace",
  /** The Daemon has said how the focused file's checkout is trusted. */
  "trust.known",
  "trust.trusted",
  "trust.declined",
  "trust.undecided",
] as const;

export type ContextKey = (typeof CONTEXT_KEYS)[number];

const isContextKey = (condition: Condition): condition is ContextKey =>
  Predicate.isString(condition);

/** Words a title takes from the context: "Restart {language} server". */
export type ContextValue =
  | "language"
  | "file"
  | "workspace"
  | "session"
  | "trustSubject"
  | "typescriptChoice"
  | "pythonInterpreter"
  | "sqlDialect"
  | "updateVersion";

export interface CommandContext {
  readonly keys: ReadonlySet<ContextKey>;
  readonly values: Readonly<Partial<Record<ContextValue, string>>>;
}

/** An availability condition over the context, like VS Code's when clauses. */
export type Condition =
  | ContextKey
  | { readonly not: Condition }
  | { readonly all: ReadonlyArray<Condition> }
  | { readonly any: ReadonlyArray<Condition> };

export const holds = (condition: Condition | undefined, keys: ReadonlySet<ContextKey>): boolean => {
  if (condition === undefined) return true;

  if (isContextKey(condition)) return keys.has(condition);

  if ("not" in condition) return !holds(condition.not, keys);

  if ("all" in condition) return condition.all.every((c) => holds(c, keys));

  return condition.any.some((c) => holds(c, keys));
};

/** A title template filled from the context; null when a word it needs is missing. */
export const fillTitle = (template: string, values: CommandContext["values"]): string | null => {
  let missing = false;

  const filled = template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = new Map(Object.entries(values)).get(name);

    if (value === undefined || value === "") missing = true;

    return value ?? "";
  });

  return missing ? null : filled;
};

export interface PaletteEntry {
  readonly group: CommandGroup;
  /** The palette's title template when it differs from the menu's ("New session in {workspace}"). */
  readonly title?: string;
  /** A caption after the title ("project 7.0.2 or bundled"). */
  readonly detail?: string;
  /** Other words it is found by. */
  readonly keywords?: ReadonlyArray<string>;
  /** It asks a follow-up in the palette; the title ends in "…". */
  readonly followUp?: boolean;
  /** Found only by searching, never listed on an empty query (easter eggs). */
  readonly searchOnly?: boolean;
}

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
  /** When it can run at all; the handler's own `enabled` is checked too. */
  readonly when?: Condition;
  /** How the Command Palette lists it; false keeps it out. Default: the app group. */
  readonly palette?: PaletteEntry | false;
}

const APP: PaletteEntry = { group: "app" };

/** The palette entry of a binding: its own, or the app group's default. */
export const paletteEntry = (binding: KeyBinding): PaletteEntry | null =>
  binding.palette === false ? null : (binding.palette ?? APP);

const FILE = (entry: Omit<PaletteEntry, "group"> = {}): PaletteEntry => ({
  group: "file",
  ...entry,
});

const WORKSPACE = (entry: Omit<PaletteEntry, "group"> = {}): PaletteEntry => ({
  group: "workspace",
  ...entry,
});

const SETTINGS = (keywords: ReadonlyArray<string>): PaletteEntry => ({ group: "app", keywords });

/** The focused file's checkout, by how the Daemon trusts it. */
const TRUST_KNOWN: Condition = { all: ["editor.file", "trust.known"] };

export const KEYMAP: ReadonlyArray<KeyBinding> = [
  {
    id: "palette.open",
    title: "Command Palette…",
    keys: ["CmdOrCtrl+Shift+P"],
    menu: "View",
    palette: false,
  },
  // Language tooling (docs/specs/editor-language-tooling-v2.md §6).
  {
    id: "language.restart",
    title: "Restart language server",
    keys: ["CmdOrCtrl+Alt+R"],
    when: { all: ["editor.file", "language.server"] },
    palette: FILE({ title: "Restart {language} server", keywords: ["lsp", "reload"] }),
  },
  {
    id: "typescript.selectVersion",
    title: "Select TypeScript version…",
    keys: [],
    when: { all: [TRUST_KNOWN, "language.typescript"] },
    palette: FILE({
      detail: "{typescriptChoice}",
      keywords: ["tsc", "project", "bundled", "tsserver"],
      followUp: true,
    }),
  },
  {
    id: "python.selectInterpreter",
    title: "Python: Select interpreter…",
    keys: [],
    when: { all: ["editor.file", "language.python"] },
    palette: FILE({
      detail: "{pythonInterpreter}",
      keywords: ["venv", "uv", "python3", "environment", "basedpyright"],
      followUp: true,
    }),
  },
  {
    id: "sql.selectDialect",
    title: "SQL: Select dialect…",
    keys: [],
    when: { all: ["editor.file", "language.sql"] },
    palette: FILE({
      detail: "{sqlDialect}",
      keywords: ["postgres", "postgresql", "mysql", "sqlite", "sqllens"],
      followUp: true,
    }),
  },
  {
    id: "editor.format",
    title: "Format document",
    keys: ["Shift+Alt+F"],
    when: { all: ["editor.file", "language.formatter"] },
    palette: FILE({ keywords: ["prettier", "ruff", "tidy"] }),
  },
  {
    id: "language.showLog",
    title: "Show language server log",
    keys: [],
    when: { all: ["editor.file", "language.server", "language.log"] },
    palette: FILE({ keywords: ["lsp", "output", "debug"] }),
  },
  {
    id: "language.restartAll",
    title: "Restart all language servers",
    keys: [],
    when: "workspace",
    palette: WORKSPACE({
      title: "Restart all language servers in {workspace}",
      keywords: ["lsp", "reload"],
    }),
  },
  {
    id: "trust.grant",
    title: "Trust workspace…",
    keys: [],
    when: { all: [TRUST_KNOWN, { not: "trust.trusted" }] },
    palette: WORKSPACE({
      title: "Trust {trustSubject}…",
      keywords: ["typescript"],
      followUp: true,
    }),
  },
  {
    id: "trust.revoke",
    title: "Revoke trust",
    keys: [],
    when: { all: [TRUST_KNOWN, "trust.trusted"] },
    palette: WORKSPACE({ title: "Revoke trust in {trustSubject}", keywords: ["untrust"] }),
  },
  {
    id: "trust.askAgain",
    title: "Ask about trust again",
    keys: [],
    when: { all: [TRUST_KNOWN, "trust.declined"] },
    palette: WORKSPACE({ keywords: ["trust", "reset", "not now"] }),
  },
  {
    id: "view.orchestrate",
    title: "Orchestrate",
    keys: ["CmdOrCtrl+1"],
    menu: "View",
    palette: { group: "app", title: "Go to Orchestrate", keywords: ["view", "mode"] },
  },
  {
    id: "view.review",
    title: "Review",
    keys: ["CmdOrCtrl+2"],
    menu: "View",
    palette: { group: "app", title: "Go to Review", keywords: ["view", "mode", "diff"] },
  },
  {
    id: "view.edit",
    title: "Edit",
    keys: ["CmdOrCtrl+3"],
    menu: "View",
    palette: { group: "app", title: "Go to Edit", keywords: ["view", "mode", "editor"] },
  },
  {
    id: "view.output",
    title: "Show or hide output",
    keys: ["CmdOrCtrl+Alt+B"],
    menu: "View",
    palette: WORKSPACE({ keywords: ["changes", "diff", "panel", "rail"] }),
  },
  { id: "jump.open", title: "Jump to…", keys: ["CmdOrCtrl+K", "K"], menu: "Go" },
  { id: "session.next", title: "Next session", keys: ["CmdOrCtrl+Alt+Down"], menu: "Go" },
  { id: "session.previous", title: "Previous session", keys: ["CmdOrCtrl+Alt+Up"], menu: "Go" },
  {
    id: "session.new",
    title: "New session",
    keys: ["CmdOrCtrl+N"],
    menu: "Session",
    palette: WORKSPACE({
      title: "New session in {workspace}",
      keywords: ["create", "start", "agent"],
    }),
  },
  {
    id: "editor.findFile",
    title: "Go to file…",
    keys: ["CmdOrCtrl+P"],
    menu: "Go",
    palette: WORKSPACE({ keywords: ["open", "file", "finder"] }),
  },
  {
    id: "editor.findInWorkspace",
    title: "Find in workspace…",
    keys: ["CmdOrCtrl+Shift+F"],
    menu: "Go",
    palette: WORKSPACE({ title: "Find in {workspace}", keywords: ["search", "grep"] }),
  },
  {
    id: "editor.inlineChat",
    title: "Edit or ask",
    keys: ["CmdOrCtrl+I"],
    palette: FILE({ keywords: ["inline", "chat", "agent"] }),
  },
  // Only with a selection in Edit; otherwise ⌘L focuses the composer.
  {
    id: "editor.addToSession",
    title: "Add to agent session",
    keys: ["CmdOrCtrl+L"],
    shares: "session.focusComposer",
    palette: FILE({ keywords: ["selection", "attach"] }),
  },
  {
    id: "session.focusComposer",
    title: "Focus the composer",
    keys: ["CmdOrCtrl+L"],
    menu: "Session",
    palette: WORKSPACE({ keywords: ["prompt", "message"] }),
  },
  {
    id: "session.interrupt",
    title: "Stop the turn",
    keys: ["CmdOrCtrl+."],
    menu: "Session",
    palette: WORKSPACE({ keywords: ["interrupt", "cancel"] }),
  },
  {
    id: "approval.approve",
    title: "Approve",
    keys: ["CmdOrCtrl+Shift+A"],
    menu: "Session",
    palette: WORKSPACE({ keywords: ["allow", "approval"] }),
  },
  {
    id: "approval.deny",
    title: "Deny",
    keys: ["CmdOrCtrl+Shift+D"],
    menu: "Session",
    palette: WORKSPACE({ keywords: ["reject", "approval"] }),
  },
  {
    id: "session.openInTerminal",
    title: "Open in terminal",
    keys: [],
    menu: "Session",
    palette: WORKSPACE({ title: "Open {session} in terminal", keywords: ["tui", "handoff"] }),
  },
  {
    id: "session.archive",
    title: "Archive session",
    keys: [],
    menu: "Session",
    palette: WORKSPACE({ title: "Archive {session}", keywords: ["close", "hide"] }),
  },
  {
    id: "theme.toggle",
    title: "Toggle dark and light",
    keys: [],
    palette: SETTINGS(["appearance", "dark", "light", "theme"]),
  },
  { id: "review.nextTab", title: "Next review tab", keys: ["CmdOrCtrl+Shift+]"], menu: "Go" },
  {
    id: "review.previousTab",
    title: "Previous review tab",
    keys: ["CmdOrCtrl+Shift+["],
    menu: "Go",
  },
  {
    id: "workspace.add",
    title: "Add workspace…",
    keys: ["CmdOrCtrl+O"],
    menu: "Go",
    palette: SETTINGS(["open", "folder", "repository"]),
  },
  // macOS's own Settings… chord, in the app menu (DESIGN.md, Settings).
  {
    id: "settings.open",
    title: "Settings…",
    keys: ["CmdOrCtrl+,"],
    menu: "App",
    palette: SETTINGS(["preferences"]),
  },
  {
    id: "settings.about",
    title: "Settings: About",
    keys: [],
    palette: SETTINGS(["version", "release", "polaris"]),
  },
  {
    id: "updates.check",
    title: "Check for updates",
    keys: [],
    palette: SETTINGS(["update", "release", "version"]),
  },
  {
    id: "updates.restart",
    title: "Restart to update",
    keys: [],
    palette: {
      group: "app",
      detail: "Polaris {updateVersion} · agent sessions keep working",
      keywords: ["update", "restart", "upgrade"],
    },
  },
  {
    id: "settings.appearance",
    title: "Settings: Appearance",
    keys: [],
    palette: SETTINGS(["theme", "density", "text size", "font", "motion", "colourblind"]),
  },
  {
    id: "settings.sessions",
    title: "Settings: Sessions",
    keys: [],
    palette: SETTINGS(["worktree", "branch", "prefix", "output", "notifications", "archive"]),
  },
  {
    id: "settings.editor",
    title: "Settings: Editor",
    keys: [],
    palette: SETTINGS(["vim", "format on save", "languages", "autosave"]),
  },
  {
    id: "settings.harnesses",
    title: "Settings: Harnesses",
    keys: [],
    palette: SETTINGS(["claude", "codex", "opencode", "sign in", "model", "permissions"]),
  },
  {
    id: "settings.constellations",
    title: "Settings: Constellations",
    keys: [],
    palette: SETTINGS(["lead", "workers"]),
  },
  {
    id: "settings.usage",
    title: "Settings: Usage",
    keys: [],
    palette: SETTINGS(["tokens", "cost", "plan limits", "rate limit"]),
  },
  {
    id: "settings.hosts",
    title: "Settings: Hosts",
    keys: [],
    palette: SETTINGS(["machines", "ssh"]),
  },
  {
    id: "settings.reviewer",
    title: "Settings: Reviewer",
    keys: [],
    palette: SETTINGS(["review", "risk summary", "model", "effort", "codex", "claude"]),
  },
  {
    id: "settings.github",
    title: "Settings: GitHub accounts",
    keys: [],
    palette: SETTINGS(["github", "account", "owner", "organization", "sign in", "pull requests"]),
  },
  {
    id: "github.addAccount",
    title: "Add GitHub account…",
    keys: [],
    palette: SETTINGS(["github", "sign in", "device code"]),
  },
  {
    id: "help.shortcuts",
    title: "Keyboard shortcuts",
    keys: ["CmdOrCtrl+/", "Shift+/"],
    menu: "Help",
    palette: SETTINGS(["help", "keys", "hotkeys"]),
  },
  // The Editor (spec §4): these keep working in every vim mode.
  {
    id: "editor.markdownPreview",
    title: "Open Markdown preview",
    keys: ["CmdOrCtrl+Shift+V"],
    menu: "View",
    palette: FILE({ keywords: ["render"] }),
  },
  { id: "editor.save", title: "Save file", keys: ["CmdOrCtrl+S"], palette: FILE() },
  { id: "editor.nextTab", title: "Next editor tab", keys: ["Ctrl+Tab"], palette: FILE() },
  {
    id: "editor.previousTab",
    title: "Previous editor tab",
    keys: ["Ctrl+Shift+Tab"],
    palette: FILE(),
  },
  // With no tab open, Close tab closes the window, as in VS Code.
  { id: "tab.close", title: "Close tab", keys: ["CmdOrCtrl+W"], menu: "File", palette: FILE() },
  {
    id: "tab.closeOthers",
    title: "Close other tabs",
    keys: ["CmdOrCtrl+Alt+T"],
    menu: "File",
    palette: FILE(),
  },
  {
    id: "window.close",
    title: "Close window",
    keys: ["CmdOrCtrl+Shift+W"],
    menu: "File",
    palette: APP,
  },
];

/** Chords macOS, Electron or the standard menus own; nothing here may take them. */
export const RESERVED: ReadonlyArray<string> = [
  "CmdOrCtrl+Q",
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
