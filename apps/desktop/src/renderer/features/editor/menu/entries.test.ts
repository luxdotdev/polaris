import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { EditorSelection } from "@codemirror/state";
import type { CommandId } from "../../../../shared/keymap.ts";
import { caretForClick } from "./caret.ts";
import {
  type EditorMenuActions,
  type MenuAction,
  editorMenuEntries,
  type MenuEntry,
  type ServerState,
  serverStateOf,
} from "./entries.ts";
import { setClientPlatform } from "../../../../shared/platform.ts";

// These tests read macOS labels ("⌘↵", "⌃Space").
beforeAll(() => setClientPlatform("darwin"));

afterAll(() => setClientPlatform(null));

const ALL_METHODS = [
  "textDocument/definition",
  "textDocument/typeDefinition",
  "textDocument/implementation",
  "textDocument/references",
  "textDocument/rename",
  "textDocument/codeAction",
  "textDocument/signatureHelp",
];

/** CSS's server: no type definition, implementation or signature help (Paper 19). */
const CSS_METHODS = [
  "textDocument/definition",
  "textDocument/references",
  "textDocument/rename",
  "textDocument/codeAction",
];

/** As gopls v0.23.0 and Phpactor 2026.10.07.0 (before Trust) reported them through the Daemon. */
const GOPLS_METHODS = [
  "textDocument/hover",
  "textDocument/signatureHelp",
  "textDocument/definition",
  "textDocument/typeDefinition",
  "textDocument/implementation",
  "textDocument/references",
  "textDocument/rename",
  "textDocument/codeAction",
  "textDocument/documentSymbol",
  "workspace/symbol",
  "textDocument/formatting",
  "textDocument/completion",
  "workspace/executeCommand",
];

const PHPACTOR_METHODS = [
  ...GOPLS_METHODS.filter((method) => method !== "textDocument/formatting"),
  "completionItem/resolve",
  "textDocument/prepareRename",
];

const ran: Array<string> = [];

const actions: EditorMenuActions = {
  navigate: (action) => ran.push(`navigate:${action}`),
  command: (id) => ran.push(`command:${id}`),
  addToSession: () => ran.push("addToSession"),
  clipboard: (what) => ran.push(`clipboard:${what}`),
  copyPath: (relative) => ran.push(`copyPath:${relative}`),
  revealInTree: () => ran.push("revealInTree"),
  openInTerminal: () => ran.push("openInTerminal"),
};

const FINDER: MenuAction = { kind: "item", label: "Reveal in Finder", onSelect: () => {} };

const menu = (
  server: ServerState,
  enabled: ReadonlyArray<CommandId> = [],
  finder: MenuAction | null = null
) => editorMenuEntries({ server, enabled: (id) => enabled.includes(id), actions, finder });

const ready = (methods: ReadonlyArray<string>): ServerState => ({
  kind: "ready",
  methods: new Set(methods),
});

/** "Label  chord" rows and "—" separators, as the menu reads. */
const read = (entries: ReadonlyArray<MenuEntry>) =>
  entries.map((entry) => {
    if (entry.kind === "separator") return "—";

    if (entry.kind !== "item") throw new Error(`no ${entry.kind} in the Editor menu`);
    const trailing = entry.disabled === true ? entry.reason : entry.shortcut;
    const label = entry.disabled === true ? `(${entry.label})` : entry.label;

    return trailing === undefined ? label : `${label}  ${trailing}`;
  });

const FILE_ROWS = [
  "—",
  "Cut  ⌘X",
  "Copy  ⌘C",
  "Paste  ⌘V",
  "—",
  "Copy path",
  "Copy relative path",
  "Reveal in file tree",
  "Open in terminal",
];

const AGENT = ["editor.inlineChat", "editor.format"] as const;

describe("the Editor's right-click menu", () => {
  test("a TypeScript file with its server ready lists every row, chords from the tables", () => {
    expect(read(menu(ready(ALL_METHODS), AGENT))).toEqual([
      "Go to definition  F12",
      "Go to type definition",
      "Go to implementation",
      "Find references  ⇧F12",
      "—",
      "Rename symbol…  F2",
      "Show code actions",
      "Format document  ⌥⇧F",
      "—",
      "Show completions  ⌃Space",
      "Show signature help  ⌃⇧Space",
      "—",
      "Edit or ask…  ⌘I",
      "Add to agent session  ⌘L",
      ...FILE_ROWS,
    ]);
  });

  test("gopls and Phpactor serve every language row", () => {
    const all = read(menu(ready(ALL_METHODS), AGENT));

    expect(read(menu(ready(GOPLS_METHODS), AGENT))).toEqual(all);
    expect(read(menu(ready(PHPACTOR_METHODS), AGENT))).toEqual(all);
  });

  test("rows the file's servers can't serve are left out (CSS, Paper 19)", () => {
    const rows = read(menu(ready(CSS_METHODS), AGENT));

    expect(rows.slice(0, 7)).toEqual([
      "Go to definition  F12",
      "Find references  ⇧F12",
      "—",
      "Rename symbol…  F2",
      "Show code actions",
      "Format document  ⌥⇧F",
      "—",
    ]);
    expect(rows).not.toContain("Go to type definition");
    expect(rows).not.toContain("Show signature help  ⌃⇧Space");
  });

  test("while a server starts its rows dim, the first saying why (Paper 19c)", () => {
    expect(read(menu({ kind: "starting" }, AGENT)).slice(0, 6)).toEqual([
      "(Go to definition)  Starting",
      "(Find references)",
      "—",
      "(Rename symbol…)",
      "—",
      "Show completions  ⌃Space",
    ]);
  });

  test("with no server, completion (the file's words) and Markdown preview stay", () => {
    expect(
      read(menu({ kind: "none" }, ["editor.inlineChat", "editor.markdownPreview"])).slice(0, 5)
    ).toEqual([
      "Show completions  ⌃Space",
      "Open Markdown preview  ⇧⌘V",
      "—",
      "Edit or ask…  ⌘I",
      "Add to agent session  ⌘L",
    ]);
  });

  test("Reveal in Finder sits between the file tree and the terminal, when given", () => {
    const rows = read(menu(ready(ALL_METHODS), AGENT, FINDER));

    expect(rows.slice(-3)).toEqual(["Reveal in file tree", "Reveal in Finder", "Open in terminal"]);
  });

  test("format shows only where the registry says it can run", () => {
    expect(read(menu(ready(ALL_METHODS), ["editor.inlineChat"]))).not.toContain(
      "Format document  ⌥⇧F"
    );
  });

  test("a label ends in … exactly when its row asks for more first", () => {
    for (const entry of menu(ready(ALL_METHODS), AGENT))
      if (entry.kind === "item") expect(entry.label.endsWith("…")).toBe(entry.needsInput === true);
  });

  test("rows run their actions", () => {
    ran.length = 0;

    for (const entry of menu(ready(ALL_METHODS), AGENT))
      if (entry.kind === "item") entry.onSelect();

    expect(ran).toContain("navigate:rename-field");
    expect(ran).toContain("navigate:completion");
    expect(ran).toContain("command:editor.format");
    expect(ran).toContain("addToSession");
    expect(ran).toContain("clipboard:paste");
    expect(ran).toContain("copyPath:true");
  });
});

describe("serverStateOf", () => {
  test("ready with its methods, starting once discovery found a server, else none", () => {
    expect(serverStateOf({ status: "ready", methods: ["textDocument/rename"] }, undefined)).toEqual(
      ready(["textDocument/rename"])
    );
    expect(serverStateOf({ status: "loading" }, { phase: "discovered", providers: [{}] })).toEqual({
      kind: "starting",
    });
    expect(
      serverStateOf({ status: "unavailable" }, { phase: "discovered", providers: [] })
    ).toEqual({ kind: "none" });
    expect(serverStateOf({ status: "loading" }, { phase: "checking", providers: [] })).toEqual({
      kind: "none",
    });
  });
});

describe("caretForClick", () => {
  const selection = EditorSelection.create([EditorSelection.range(10, 20)]);

  test("a click inside the selection keeps it", () => {
    expect(caretForClick(selection, 15)).toBeNull();
    expect(caretForClick(selection, 20)).toBeNull();
  });

  test("a click outside it moves the caret there", () => {
    expect(caretForClick(selection, 25)).toBe(25);
    expect(caretForClick(EditorSelection.single(4), 4)).toBe(4);
  });

  test("a click on no text leaves the caret", () => {
    expect(caretForClick(selection, null)).toBeNull();
  });
});
