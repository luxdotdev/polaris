/**
 * Which quick fix an import Edit Prediction offers (docs/specs/edit-prediction-v1.1.md §5
 * "Imports"): a pure function of the server's actions. `selectImportAction` is the one binding the
 * Editor calls; a tuned rule replaces it there and nowhere else.
 */
import {
  isNoOpCommand,
  type LspCodeAction,
  type LspDiagnostic,
  selectImportFix,
  UNRESOLVED_NAME_CODES,
} from "@polaris/predict";
import type * as P from "@polaris/protocol";

/** The fields of an LSP `CodeAction` the rule reads. */
export interface ImportAction {
  readonly title: string;
  readonly kind?: string;
  readonly isPreferred?: boolean;
  readonly disabled?: { readonly reason: string };
  readonly edit?: P.LanguageWorkspaceEdit;
  readonly command?: string | object;
}

/** The document the diagnostic is in, as the language server knows it. */
export interface ImportDocument {
  readonly uri: string;
  readonly version: number;
  readonly text: string;
}

/** One unresolved-name diagnostic and the quick fixes its server returned. */
export interface ImportName {
  readonly diagnostic: LspDiagnostic;
  readonly actions: ReadonlyArray<ImportAction>;
}

export interface ImportInsert {
  readonly at: typeof P.LanguagePosition.Type;
  readonly text: string;
}

export interface ImportChoice {
  readonly title: string;
  /** Pure insertions into `ImportDocument`, in the server's order. */
  readonly inserts: ReadonlyArray<ImportInsert>;
}

/** `names` in document order. */
export type ImportActionSelector = (
  document: ImportDocument,
  names: ReadonlyArray<ImportName>
) => ImportChoice | null;

type TextEdit = typeof P.LanguageTextEdit.Type;

const isQuickFix = (action: ImportAction) =>
  action.disabled === undefined &&
  (action.kind === undefined || action.kind === "quickfix" || action.kind.startsWith("quickfix."));

const insertsOf = (edits: ReadonlyArray<TextEdit>): ImportInsert[] | null => {
  const inserts = edits.map((edit) => ({ at: edit.range.start, text: edit.newText }));

  const pure = edits.every(
    (edit) =>
      edit.newText.length > 0 &&
      edit.range.start.line === edit.range.end.line &&
      edit.range.start.character === edit.range.end.character
  );

  return pure ? inserts : null;
};

const fromChanges = (
  changes: NonNullable<P.LanguageWorkspaceEdit["changes"]>,
  uri: string
): ReadonlyArray<TextEdit> | null => {
  const entries = Object.entries(changes);

  return entries.every(([key]) => key === uri) ? entries.flatMap(([, edits]) => edits) : null;
};

const fromDocumentChanges = (
  changes: NonNullable<P.LanguageWorkspaceEdit["documentChanges"]>,
  document: Omit<ImportDocument, "text">
): ReadonlyArray<TextEdit> | null => {
  const edits: TextEdit[] = [];

  for (const change of changes) {
    if (!("textDocument" in change) || change.textDocument.uri !== document.uri) return null;

    if (change.textDocument.version !== null && change.textDocument.version !== document.version)
      return null;
    edits.push(...change.edits);
  }

  return edits;
};

const confirms = (edit: P.LanguageWorkspaceEdit) =>
  Object.values(edit.changeAnnotations ?? {}).some((note) => note.needsConfirmation === true);

const harmless = (command: ImportAction["command"]) =>
  command === undefined || isNoOpCommand(command);

/** Only text insertions into this one document; a command may ride along only if it does nothing. */
export const insertOnlyEdit = (
  action: ImportAction,
  document: Omit<ImportDocument, "text">
): ReadonlyArray<ImportInsert> | null => {
  const { edit } = action;

  if (edit === undefined || !harmless(action.command) || confirms(edit)) return null;

  if (edit.changes !== undefined && edit.documentChanges !== undefined) return null;

  const edits =
    edit.documentChanges === undefined
      ? fromChanges(edit.changes ?? {}, document.uri)
      : fromDocumentChanges(edit.documentChanges, document);

  if (edits === null || edits.length === 0) return null;

  return insertsOf(edits);
};

const choiceOf = (action: ImportAction, document: ImportDocument): ImportChoice | null => {
  const inserts = insertOnlyEdit(action, document);

  return inserts === null ? null : { title: action.title, inserts };
};

/** The spec's rule on the first name: the only quick fix, or the only preferred one. */
export const specImportRule: ImportActionSelector = (document, names) => {
  const fixes = (names[0]?.actions ?? []).filter(isQuickFix);
  const preferred = fixes.filter((action) => action.isPreferred === true);
  const [chosen] = fixes.length === 1 ? fixes : preferred.length === 1 ? preferred : [];

  return chosen === undefined ? null : choiceOf(chosen, document);
};

/** Commands other than the no-op become `disabled`, so the rule still counts every action. */
const lspAction = (action: ImportAction): LspCodeAction => {
  let out: LspCodeAction = { title: action.title };

  if (action.kind !== undefined) out = { ...out, kind: action.kind };

  if (action.isPreferred !== undefined) out = { ...out, isPreferred: action.isPreferred };

  if (action.edit !== undefined) out = { ...out, edit: action.edit };

  if (action.disabled !== undefined || !harmless(action.command))
    out = { ...out, disabled: action.disabled ?? { reason: "runs a command" } };

  return out;
};

/**
 * The measured rule for TypeScript (docs/research/next-edit-spike.md, "Imports"): the preferred
 * import, else the module the file imports or that resolves every name, then this fence.
 */
export const moduleImportRule: ImportActionSelector = (document, names) => {
  const originals = new Map<LspCodeAction, ImportAction>();

  const lsp = names.map((name) => ({
    diagnostic: name.diagnostic,
    actions: name.actions.map((action) => {
      const converted = lspAction(action);
      originals.set(converted, action);

      return converted;
    }),
  }));

  const choice = selectImportFix(document, lsp);
  const action = choice === null ? undefined : originals.get(choice.action);

  return action === undefined ? null : choiceOf(action, document);
};

const typescript = (name: ImportName) => UNRESOLVED_NAME_CODES.has(Number(name.diagnostic.code));

/** The rule the Editor uses: the module rule for TypeScript's codes, the spec's for others. */
export const selectImportAction: ImportActionSelector = (document, names) =>
  names.length > 0 && names.every(typescript)
    ? moduleImportRule(document, names)
    : specImportRule(document, names);
