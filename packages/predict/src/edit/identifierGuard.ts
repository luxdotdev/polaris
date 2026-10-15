import type { EditPredictionRequest, PredictedEdit } from "@polaris/protocol";

const word = /[\p{L}\p{N}_$]/u;

const identifier = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;

const tokens = (source: string) =>
  [
    ...source.matchAll(
      /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[\p{L}_$][\p{L}\p{N}_$]*/gu
    ),
  ].flatMap((match) => (identifier.test(match[0]) ? [match[0]] : []));

const declarations = (source: string) =>
  new Set(
    [
      ...source.matchAll(
        /\b(?:const|let|var|function|class|interface|type)\s+([\p{L}_$][\p{L}\p{N}_$]*)/gu
      ),
    ].map((match) => match[1]!)
  );

/** Local names bound by import clauses, once per binding. */
export const importBindings = (source: string) =>
  [...source.matchAll(/\bimport\s+([^;]*?)\s+from\s+["']/g)].flatMap((match) => {
    const clause = (match[1] ?? "").replace(/^type\s+/, "");

    return clause.split(/[,{}]/).flatMap((part) => {
      const local =
        part
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)
          .at(-1) ?? "";

      return identifier.test(local) ? [local] : [];
    });
  });

const imports = (source: string) => new Set(importBindings(source));

const identifierSpan = (source: string, from: number, to: number) => {
  while (from > 0 && word.test(source[from - 1]!)) from--;

  while (to < source.length && word.test(source[to]!)) to++;

  const name = source.slice(from, to);

  return identifier.test(name) ? { name, from, to } : null;
};

const replacements = (before: string, after: string, edits: readonly PredictedEdit[]) => {
  let shift = 0;

  return edits.flatMap((edit) => {
    const old = identifierSpan(before, edit.from, edit.to);
    const next = identifierSpan(after, edit.from + shift, edit.from + shift + edit.text.length);
    shift += edit.text.length - (edit.to - edit.from);

    return old && next && old.name !== next.name ? [{ old, next }] : [];
  });
};

const lineSyntax = (source: string, at: number) => {
  const from = source.lastIndexOf("\n", at - 1) + 1;
  const end = source.indexOf("\n", at);

  return source
    .slice(from, end < 0 ? source.length : end)
    .replace(/[\p{L}_$][\p{L}\p{N}_$]*/gu, "_")
    .replace(/\s/g, "");
};

const historyNames = (request: EditPredictionRequest) => {
  const history = request.history.filter((hunk) => hunk.path === request.path);
  const beforeTokens = tokens(history.map((hunk) => hunk.before).join("\n"));
  const afterTokens = tokens(history.map((hunk) => hunk.after).join("\n"));

  const before = new Set(beforeTokens),
    after = new Set(afterTokens);

  const counts = (values: readonly string[]) => {
    const result = new Map<string, number>();

    for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);

    return result;
  };

  const oldCounts = counts(beforeTokens),
    newCounts = counts(afterTokens);

  return {
    added: new Set([...after].filter((name) => !before.has(name))),
    removed: new Set(
      [...before].filter((name) => (oldCounts.get(name) ?? 0) > (newCounts.get(name) ?? 0))
    ),
    after,
  };
};

/** Lexical evidence only: this deliberately does not claim scope or type resolution. */
export const unsafeIdentifiers = (
  request: EditPredictionRequest,
  after: string,
  edits: readonly PredictedEdit[]
) => {
  if (!request.history.some((hunk) => hunk.path === request.path)) return false;

  const beforeDeclarations = declarations(request.buffer),
    afterDeclarations = declarations(after);

  const imported = imports(after);
  const history = historyNames(request);

  if (
    [...beforeDeclarations].some(
      (name) => !afterDeclarations.has(name) && !history.removed.has(name)
    )
  )
    return true;

  if ([...afterDeclarations].some((name) => !beforeDeclarations.has(name) && imported.has(name)))
    return true;

  return replacements(request.buffer, after, edits).some(({ old, next }) => {
    if (
      beforeDeclarations.has(old.name) &&
      !afterDeclarations.has(old.name) &&
      !beforeDeclarations.has(next.name) &&
      afterDeclarations.has(next.name) &&
      !history.after.has(next.name)
    )
      return true;

    if (lineSyntax(request.buffer, old.from) !== lineSyntax(after, next.from)) return false;

    if (!history.added.has(next.name)) return false;

    if (!history.removed.has(old.name)) return true;

    if (request.buffer[old.from - 1] === ".") return false;

    // A renamed reference needs a binding, including typed parameters and destructured fields.
    const escaped = next.name.replaceAll("$", "\\$");
    const typed = new RegExp(`\\b${escaped}\\s*[:=]`, "u").test(after);

    return !typed && !afterDeclarations.has(next.name) && !imported.has(next.name);
  });
};
