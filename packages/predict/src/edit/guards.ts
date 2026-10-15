import type { EditPredictionRequest, PredictedEdit, SuppressedReason } from "@polaris/protocol";
import { applyEdits } from "./apply.ts";
import { deletesUnprompted } from "./deletionGuard.ts";
import { duplicates } from "./duplicateGuard.ts";
import { readsOwnDeclaration } from "./selfReferenceGuard.ts";
import { strays } from "./relevanceGuard.ts";
import { changesBlankLines, unbalancesDelimiters } from "./delimiterGuard.ts";
import { unsafeIdentifiers } from "./identifierGuard.ts";
import { changesHistory } from "./historyGuard.ts";
import {
  duplicatesImport,
  inventsNames,
  renamesDeclaration,
  restoresRemovedNames,
} from "./novelGuard.ts";
import type { EditOptions } from "./options.ts";
import type { EditWindow } from "./window.ts";

export { applyEdits } from "./apply.ts";

const unstable = (request: EditPredictionRequest, edit: PredictedEdit) => {
  const start = request.buffer.lastIndexOf("\n", edit.from - 1) + 1;
  const end = request.buffer.indexOf("\n", edit.to);
  const oldLine = request.buffer.slice(start, end < 0 ? request.buffer.length : end);

  const newLine =
    request.buffer.slice(start, edit.from) +
    edit.text +
    request.buffer.slice(edit.to, end < 0 ? request.buffer.length : end);

  const focus = request.focus ?? request.cursor;
  const focused = focus >= start && (end < 0 || focus <= end);

  if (focused || changesBlankLines(request.buffer, edit, start)) return false;

  if (oldLine.replace(/\s/g, "") === newLine.replace(/\s/g, "")) return true;

  if (/^\s*[}\])`'";,]+\s*$/.test(oldLine)) return true;
  // Expanding a healthy shorthand can bypass a local default or normalization.
  const shorthand = /^\s*([\w$]+),\s*$/.exec(oldLine);

  return shorthand !== null && newLine.trimStart().startsWith(`${shorthand[1]}:`);
};

type GuardOptions = Partial<
  Pick<
    EditOptions,
    | "novelNames"
    | "declarationRenames"
    | "removedNames"
    | "deletionEvidence"
    | "relevance"
    | "duplicates"
    | "selfReference"
  >
>;

export const guardEdits = (
  request: EditPredictionRequest,
  window: EditWindow,
  edits: readonly PredictedEdit[],
  options?: GuardOptions
) => {
  if (!edits.length) return { edits: [], suppressed: [] };

  const after = applyEdits(request.buffer, edits);
  const on = (flag: keyof GuardOptions) => options?.[flag] === true;

  const checks: readonly (readonly [SuppressedReason, () => boolean])[] = [
    ["outside-window", () => edits.some((edit) => edit.from < window.from || edit.to > window.to)],
    ["revert", () => changesHistory(request, after, edits)],
    ["unstable", () => request.buffer.replace(/\s/g, "") === after.replace(/\s/g, "")],
    ["unstable", () => edits.some((edit) => unstable(request, edit))],
    ["unstable", () => unbalancesDelimiters(request, after, edits)],
    ["unstable", () => unsafeIdentifiers(request, after, edits)],
    ["unstable", () => on("novelNames") && inventsNames(request, after)],
    ["unstable", () => on("novelNames") && duplicatesImport(request, after)],
    ["unstable", () => on("declarationRenames") && renamesDeclaration(request, after)],
    ["revert", () => on("removedNames") && restoresRemovedNames(request, edits)],
    ["unstable", () => on("deletionEvidence") && deletesUnprompted(request, edits)],
    ["unstable", () => on("relevance") && strays(request, edits)],
    ["unstable", () => on("duplicates") && duplicates(request.buffer, after)],
    ["unstable", () => on("selfReference") && readsOwnDeclaration(request.buffer, after)],
  ];

  const reason = checks.find(([, check]) => check())?.[0];

  // Treat a region rewrite atomically: retained hunks may depend on a dropped hunk.
  return reason
    ? { edits: [], suppressed: edits.map(({ from, to }) => ({ reason, from, to })) }
    : { edits: [...edits], suppressed: [] };
};
