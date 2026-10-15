import type { EditPredictionRequest, PredictedEdit } from "@polaris/protocol";
import { counts } from "./novelGuard.ts";
import { lineAt } from "./window.ts";

const words = (source: string) => source.match(/[\p{L}_$][\p{L}\p{N}_$]*/gu) ?? [];

const trimmedLines = (source: string) =>
  source
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** Hunks on adjacent lines form one change; a rewrite may hold several. */
export const changes = (buffer: string, edits: readonly PredictedEdit[]) => {
  const groups: PredictedEdit[][] = [];

  for (const edit of edits) {
    const group = groups.at(-1);
    const last = group?.at(-1);

    if (group && last && lineAt(buffer, edit.from) - lineAt(buffer, last.to) <= 1) group.push(edit);
    else groups.push([edit]);
  }

  return groups;
};

/** Deleting whole lines needs evidence in the history: a name it removed, moved or now imports. */
export const deletesUnprompted = (
  request: EditPredictionRequest,
  edits: readonly PredictedEdit[]
) => {
  const history = request.history.filter((hunk) => hunk.path === request.path);
  const was = counts(words(history.map((hunk) => hunk.before).join("\n")));
  const now = counts(words(history.map((hunk) => hunk.after).join("\n")));

  const removed = new Set(
    [...was].flatMap(([name, count]) => (count > (now.get(name) ?? 0) ? [name] : []))
  );

  const added = new Set(history.flatMap((hunk) => trimmedLines(hunk.after)));

  const imported = new Set(
    history
      .flatMap((hunk) => trimmedLines(hunk.after))
      .filter((line) => line.startsWith("import "))
      .flatMap((line) => words(line.replace(/\bfrom\s+["'][^"']*["'].*$/, "")))
      .filter((name) => !["import", "type", "as"].includes(name))
  );

  return changes(request.buffer, edits).some((change) => {
    if (change.some((edit) => edit.text.trim())) return false;
    const gone = change.map((edit) => request.buffer.slice(edit.from, edit.to)).join("\n");

    if (!gone.includes("\n") || !words(gone).length) return false;

    return !(
      words(gone).some((name) => removed.has(name) || imported.has(name)) ||
      trimmedLines(gone).some((line) => added.has(line))
    );
  });
};
