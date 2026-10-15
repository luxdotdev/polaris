import type { EditPredictionRequest, PredictedEdit } from "@polaris/protocol";
import { applyEdits } from "./apply.ts";

/** Names every TypeScript file may use without defining or importing them. */
const ambient = new Set(
  [
    "break case catch class const continue debugger default delete do else export extends false",
    "finally for function if import in instanceof new null return super switch this throw true try",
    "typeof var void while with yield let static enum await implements package protected interface",
    "private public as async from of type readonly keyof infer satisfies declare namespace abstract",
    "override is unique never unknown any string number boolean bigint symbol object undefined get",
    "set constructor globalThis Infinity NaN Math JSON Promise Array Object Number String Boolean",
    "Error Map Set WeakMap WeakSet Date RegExp Symbol Uint8Array ArrayBuffer TextEncoder TextDecoder",
    "URL AbortController AbortSignal Response Request fetch console process window document Bun",
    "setTimeout clearTimeout setInterval clearInterval queueMicrotask structuredClone parseInt",
    "parseFloat require module exports Record Partial Required Readonly ReadonlyArray ReadonlySet",
    "ReadonlyMap Pick Omit Exclude Extract NonNullable ReturnType Parameters Awaited",
  ]
    .join(" ")
    .split(" ")
);

const code = (source: string) =>
  source.replace(
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g,
    " "
  );

const names = (source: string) => code(source).match(/[\p{L}_$][\p{L}\p{N}_$]*/gu) ?? [];

const counts = (values: readonly string[]) => {
  const result = new Map<string, number>();

  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);

  return result;
};

const declared = (source: string) =>
  new Set(
    [
      ...code(source).matchAll(
        /\b(?:const|let|var|function|class|interface|type)\s+([\p{L}_$][\p{L}\p{N}_$]*)/gu
      ),
    ].map((match) => match[1] ?? "")
  );

const typingAt = (request: EditPredictionRequest) =>
  /[\p{L}\p{N}_$]*$/u.exec(request.buffer.slice(0, request.cursor))?.[0] ?? "";

/** Renaming an existing declaration, other than the one being typed, rewrites healthy code. */
export const renamesDeclaration = (request: EditPredictionRequest, after: string) => {
  const before = declared(request.buffer),
    next = declared(after);

  const typing = typingAt(request);

  return (
    [...before].some((name) => !next.has(name) && name !== typing) &&
    [...next].some((name) => !before.has(name))
  );
};

/** Bringing back, away from the cursor line, a name the history removed undoes the user's intent. */
export const restoresRemovedNames = (
  request: EditPredictionRequest,
  edits: readonly PredictedEdit[]
) => {
  const history = request.history.filter((hunk) => hunk.path === request.path);
  const was = counts(history.flatMap((hunk) => names(hunk.before)));
  const now = counts(history.flatMap((hunk) => names(hunk.after)));
  const start = request.buffer.lastIndexOf("\n", request.cursor - 1) + 1;
  const end = request.buffer.indexOf("\n", request.cursor);
  const lineEnd = end < 0 ? request.buffer.length : end;
  const away = edits.filter((edit) => edit.from < start || edit.to > lineEnd);
  const before = counts(names(request.buffer));
  const after = counts(names(applyEdits(request.buffer, away)));

  return [...was].some(
    ([name, count]) =>
      count > (now.get(name) ?? 0) && (after.get(name) ?? 0) > (before.get(name) ?? 0)
  );
};

/** An identifier the buffer, its history and its path never mention is the model's invention. */
export const inventsNames = (request: EditPredictionRequest, after: string) => {
  const known = new Set(
    names(
      [request.buffer, request.path, ...request.history.flatMap((h) => [h.before, h.after])].join(
        "\n"
      )
    )
  );

  // The word being typed at the cursor may legitimately complete to a new name.
  const typing = typingAt(request);

  return names(after).some(
    (name) => !known.has(name) && !ambient.has(name) && !(typing && name.startsWith(typing))
  );
};
