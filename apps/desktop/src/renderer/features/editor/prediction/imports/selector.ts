/**
 * Which quick fix an import Edit Prediction offers (docs/specs/edit-prediction-v1.1.md §5
 * "Imports"): a pure function of the server's actions. `selectImportAction` is the one binding the
 * Editor calls; a tuned rule replaces it there and nowhere else.
 */
import type * as P from "@polaris/protocol";

/** The fields of an LSP `CodeAction` the rule reads. */
export interface ImportAction {
  readonly title: string;
  readonly kind?: string;
  readonly isPreferred?: boolean;
  readonly disabled?: { readonly reason: string };
  readonly edit?: P.LanguageWorkspaceEdit;
  readonly command?: unknown;
}

/** The document the diagnostic is in, as the language server knows it. */
export interface ImportDocument {
  readonly uri: string;
  readonly version: number;
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

export type ImportActionSelector = (
  actions: ReadonlyArray<ImportAction>,
  document: ImportDocument
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
  document: ImportDocument
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

/** Only text insertions into this one document, with no command riding along. */
export const insertOnlyEdit = (
  action: ImportAction,
  document: ImportDocument
): ReadonlyArray<ImportInsert> | null => {
  const { edit } = action;

  if (edit === undefined || action.command !== undefined || confirms(edit)) return null;

  if (edit.changes !== undefined && edit.documentChanges !== undefined) return null;

  const edits =
    edit.documentChanges === undefined
      ? fromChanges(edit.changes ?? {}, document.uri)
      : fromDocumentChanges(edit.documentChanges, document);

  if (edits === null || edits.length === 0) return null;

  return insertsOf(edits);
};

/** The spec's rule: the only quick fix, or the only preferred one, if it only inserts here. */
export const specImportRule: ImportActionSelector = (actions, document) => {
  const fixes = actions.filter(isQuickFix);
  const preferred = fixes.filter((action) => action.isPreferred === true);
  const [chosen] = fixes.length === 1 ? fixes : preferred.length === 1 ? preferred : [];

  if (chosen === undefined) return null;
  const inserts = insertOnlyEdit(chosen, document);

  return inserts === null ? null : { title: chosen.title, inserts };
};

/** The rule the Editor uses. */
export const selectImportAction: ImportActionSelector = specImportRule;
