import { Schema } from "effect";

/** LSP shapes the import choice reads; positions are in the negotiated encoding, compared only. */
export interface LspPosition {
  readonly line: number;
  readonly character: number;
}

export interface LspRange {
  readonly start: LspPosition;
  readonly end: LspPosition;
}

export interface LspTextEdit {
  readonly range: LspRange;
  readonly newText: string;
}

export interface LspCommand {
  readonly title?: string;
  readonly command: string;
  readonly arguments?: readonly unknown[];
}

export interface LspCodeAction {
  readonly title: string;
  readonly kind?: string;
  readonly isPreferred?: boolean;
  readonly disabled?: unknown;
  readonly command?: LspCommand;
  readonly edit?: {
    readonly changes?: Readonly<Record<string, readonly LspTextEdit[]>>;
    readonly documentChanges?: readonly (
      | { readonly textDocument: { readonly uri: string }; readonly edits: readonly LspTextEdit[] }
      | { readonly kind: string }
    )[];
  };
}

export interface LspDiagnostic {
  readonly range: LspRange;
  readonly message: string;
  readonly code?: number | string;
}

/** One unresolved-name diagnostic and the quick fixes the server returned for it. */
export interface UnresolvedName {
  readonly diagnostic: LspDiagnostic;
  readonly actions: readonly LspCodeAction[];
}

export interface ImportChoice {
  readonly action: LspCodeAction;
  readonly diagnostic: LspDiagnostic;
  readonly module: string;
  readonly edits: readonly LspTextEdit[];
}

/**
 * `spec`: the only action, or the one the server prefers. `module` adds, when no fix is
 * preferred, the candidate whose module the file already imports or that resolves every name.
 */
export type ImportRule = "spec" | "module";

/** "Cannot find name", its "Did you mean" form, namespaces, and shorthand properties. */
export const UNRESOLVED_NAME_CODES: ReadonlySet<number> = new Set([2304, 2552, 2503, 18004]);

const IMPORT_TITLE = /^(?:Add|Update) import from "([^"]+)"/;

// Only the fix's own tsserver `commands` run, and import fixes have none.
const TsApplyCommand = Schema.Struct({
  command: Schema.Literal("_typescript.applyCodeActionCommand"),
  arguments: Schema.Tuple([
    Schema.Struct({
      action: Schema.Struct({ commands: Schema.optionalKey(Schema.Array(Schema.Unknown)) }),
    }),
  ]),
});

const isTsApplyCommand = Schema.is(TsApplyCommand);

/** typescript-language-server attaches a command to every quick fix; any other could do anything. */
const harmlessCommand = (command: LspCommand | undefined) =>
  command === undefined ||
  (isTsApplyCommand(command) && (command.arguments[0].action.commands ?? []).length === 0);

const edits = (action: LspCodeAction, uri: string): readonly LspTextEdit[] | undefined => {
  const { changes, documentChanges } = action.edit ?? {};

  if (!harmlessCommand(action.command) || action.disabled !== undefined) return undefined;

  if (documentChanges)
    return documentChanges.every((c) => "textDocument" in c && c.textDocument.uri === uri)
      ? documentChanges.flatMap((c) => ("edits" in c ? c.edits : []))
      : undefined;

  if (!changes) return undefined;
  const uris = Object.keys(changes);

  return uris.length === 1 && uris[0] === uri ? changes[uri] : undefined;
};

const inserts = (list: readonly LspTextEdit[]) =>
  list.length > 0 &&
  list.every(
    ({ range: { start, end } }) => start.line === end.line && start.character === end.character
  );

interface Candidate extends ImportChoice {
  readonly order: number;
}

/** Import fixes that edit only this document and only insert. */
const candidates = (uri: string, name: UnresolvedName): Candidate[] =>
  name.actions.flatMap((action, order) => {
    const module = IMPORT_TITLE.exec(action.title)?.[1];
    const list = edits(action, uri);

    return module !== undefined && list !== undefined && inserts(list)
      ? [{ action, diagnostic: name.diagnostic, module, edits: list, order }]
      : [];
  });

const importedModules = (text: string) =>
  new Set([...text.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]));

const srcRoot = (path: string) => {
  const at = path.lastIndexOf("/src/");

  return at === -1 ? undefined : path.slice(0, at);
};

/** A relative path into another package's `src`, where a bare package name competes. */
const foreign = (uri: string, module: string) => {
  if (!module.startsWith(".")) return false;
  const from = new URL(uri).pathname;
  const to = new URL(module, uri).pathname;
  const a = srcRoot(from);
  const b = srcRoot(to);

  return a !== undefined && b !== undefined && a !== b;
};

const byModule = (
  uri: string,
  options: readonly Candidate[],
  imported: ReadonlySet<string | undefined>,
  everyName: ReadonlySet<string>
) => {
  const known = options.filter((c) => imported.has(c.module));

  if (known.length === 1) return known[0];
  const shared = options.filter((c) => everyName.has(c.module));

  if (shared.length === 1) return shared[0];

  const local = options.some((c) => !c.module.startsWith("."))
    ? options.filter((c) => !foreign(uri, c.module))
    : options;

  return local.length === 1 ? local[0] : undefined;
};

const choose = (
  uri: string,
  name: UnresolvedName,
  options: readonly Candidate[],
  rule: ImportRule,
  context: { imported: ReadonlySet<string | undefined>; everyName: ReadonlySet<string> }
) => {
  if (name.actions.length === 1 && options.length === 1) return options[0];
  const preferred = options.filter((c) => c.action.isPreferred === true);

  if (preferred.length === 1) return preferred[0];

  return rule === "module" && preferred.length === 0
    ? byModule(uri, options, context.imported, context.everyName)
    : undefined;
};

/**
 * The import to offer for a burst's unresolved names, in document order, or null. The edit is
 * the server's; offer it as "Add import from …" and apply it through the edit fence.
 */
export const selectImportFix = (
  document: { readonly uri: string; readonly text: string },
  names: readonly UnresolvedName[],
  rule: ImportRule = "module"
): ImportChoice | null => {
  const options = names.map((name) => candidates(document.uri, name));
  const modules = options.map((list) => new Set(list.map((c) => c.module)));

  const everyName = new Set(
    [...(modules[0] ?? [])].filter((module) => modules.every((set) => set.has(module)))
  );

  const context = { imported: importedModules(document.text), everyName };

  const ordered = names
    .map((name, i) => ({ name, list: options[i] ?? [] }))
    .sort(
      (a, b) =>
        a.name.diagnostic.range.start.line - b.name.diagnostic.range.start.line ||
        a.name.diagnostic.range.start.character - b.name.diagnostic.range.start.character
    );

  for (const { name, list } of ordered) {
    const choice = choose(document.uri, name, list, rule, context);

    if (choice) {
      const { order: _, ...rest } = choice;

      return rest;
    }
  }

  return null;
};

/** The burst's lines in the document and the names its text wrote. */
export interface Burst {
  readonly lines: ReadonlySet<number>;
  readonly names: ReadonlySet<string>;
}

/**
 * Unresolved-name diagnostics to ask quick fixes for: on a line the burst changed, or naming
 * something the burst wrote (a re-export or a moved declaration leaves its uses elsewhere).
 */
export const unresolvedInBurst = <D extends LspDiagnostic>(
  diagnostics: readonly D[],
  burst: Burst
): D[] =>
  diagnostics.filter((d) => {
    if (!UNRESOLVED_NAME_CODES.has(Number(d.code))) return false;

    for (let line = d.range.start.line; line <= d.range.end.line; line++)
      if (burst.lines.has(line)) return true;
    const name = /'([$\w]+)'/.exec(d.message)?.[1];

    return name !== undefined && burst.names.has(name);
  });
