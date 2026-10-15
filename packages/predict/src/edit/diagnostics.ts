import type { PredictedEdit } from "@polaris/protocol";
import { applyEdits } from "./apply.ts";

/** A language server diagnostic, as offsets into the buffer it was computed on. */
export interface BufferDiagnostic {
  readonly from: number;
  readonly to: number;
  readonly severity: "error" | "warning" | "information" | "hint";
  readonly code: string;
  readonly message: string;
}

/** Diagnostics of the buffer, and of the buffer with the predicted edits applied. */
export interface DiagnosticsCheck {
  readonly buffer: string;
  readonly edits: readonly PredictedEdit[];
  readonly before: readonly BufferDiagnostic[];
  readonly after: readonly BufferDiagnostic[];
  /** Errors in `before` that the language server offers to fix with an import. */
  readonly importable?: readonly BufferDiagnostic[];
  /** The cursor in `buffer`: an edit starting on its line completes what the user is typing. */
  readonly cursor?: number;
}

export type DiagnosticsVerdict =
  | { readonly allow: true }
  | {
      readonly allow: false;
      readonly reason: "diagnostics";
      /** Errors the edits add. */
      readonly introduced: readonly BufferDiagnostic[];
      /** Importable errors the edits make disappear without the import (a local stand-in). */
      readonly shadowed: readonly BufferDiagnostic[];
    };

const key = (diagnostic: BufferDiagnostic) => `${diagnostic.code}\u0000${diagnostic.message}`;

const errorCounts = (diagnostics: readonly BufferDiagnostic[]) => {
  const counts = new Map<string, number>();

  for (const diagnostic of diagnostics)
    if (diagnostic.severity === "error")
      counts.set(key(diagnostic), (counts.get(key(diagnostic)) ?? 0) + 1);

  return counts;
};

/**
 * Errors after the edits that the buffer did not already have. Matching is by code and message,
 * not position, so errors the edits merely move (or the user's own unfinished code) never count.
 */
export const introducedErrors = (check: DiagnosticsCheck) => {
  const known = errorCounts(check.before);

  return check.after.filter((diagnostic) => {
    if (diagnostic.severity !== "error") return false;
    const left = known.get(key(diagnostic)) ?? 0;

    if (left > 0) known.set(key(diagnostic), left - 1);

    return left === 0;
  });
};

const IMPORT = /\bimport\s([^;]*?)\bfrom\s*["'][^"'\n]+["']/g;

/** Names bound by the buffer's import declarations. */
const importedNames = (buffer: string) =>
  new Set([...buffer.matchAll(IMPORT)].flatMap((match) => match[1]?.match(/[\w$]+/g) ?? []));

const uses = (text: string, name: string) =>
  text.match(new RegExp(`(?<![\\w$])${name.replace(/\$/g, "\\$")}(?![\\w$])`, "g"))?.length ?? 0;

/** An edit starts on the cursor's line: it completes what the user is typing. */
const continuesCursorLine = (check: DiagnosticsCheck) => {
  if (check.cursor === undefined) return false;
  const lineStart = check.buffer.lastIndexOf("\n", check.cursor - 1) + 1;

  return check.edits.some(
    (edit) => edit.from >= lineStart && !check.buffer.slice(lineStart, edit.from).includes("\n")
  );
};

/** Importable errors that the edits resolve without importing the name (a local stand-in). */
export const shadowedImports = (check: DiagnosticsCheck) => {
  if (continuesCursorLine(check)) return [];
  const before = errorCounts(check.before);
  const after = errorCounts(check.after);
  const edited = applyEdits(check.buffer, check.edits);
  const already = importedNames(check.buffer);
  const imported = importedNames(edited);

  // Renames and deletions remove the reference; a stand-in keeps it and declares the name.
  return (check.importable ?? []).filter((diagnostic) => {
    const name = check.buffer.slice(diagnostic.from, diagnostic.to);

    return (
      (after.get(key(diagnostic)) ?? 0) < (before.get(key(diagnostic)) ?? 0) &&
      uses(edited, name) > uses(check.buffer, name) &&
      !(imported.has(name) && !already.has(name))
    );
  });
};

/** Suppress a prediction that adds an error, or stands in locally for a name it should import. */
export const verifyDiagnostics = (check: DiagnosticsCheck): DiagnosticsVerdict => {
  const introduced = introducedErrors(check);
  const shadowed = shadowedImports(check);

  return introduced.length || shadowed.length
    ? { allow: false, reason: "diagnostics", introduced, shadowed }
    : { allow: true };
};
