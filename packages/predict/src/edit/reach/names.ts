import type { EditHistoryHunk } from "@polaris/protocol";

const IDENTIFIER = /[$A-Z_a-z][$\w]*/g;

// Too common to point anywhere: keywords, literals and the usual members.
const NOISE = new Set(
  (
    "as async await break case catch class const continue default delete do else export extends " +
    "false finally for from function if import in instanceof let new null of return static super " +
    "switch this throw true try type typeof undefined var void while yield readonly interface " +
    "string number boolean unknown never any length map filter push get set has value key id"
  ).split(" ")
);

export interface Occurrence {
  readonly name: string;
  readonly offset: number;
}

export const identifiers = (text: string): Occurrence[] =>
  [...text.matchAll(IDENTIFIER)].map((match) => ({ name: match[0], offset: match.index }));

// Comment prose names nothing but its `code`; strings stay, since copy is renamed too.
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?(?:\*\/|$)|\/\/.*$|^\s*\*.*$/gm, (comment) =>
    (comment.match(/`[^`]*`/g) ?? []).join(" ")
  );

const counts = (text: string) => {
  const result = new Map<string, number>();

  for (const { name } of identifiers(code(text))) result.set(name, (result.get(name) ?? 0) + 1);

  return result;
};

export const meaningful = (name: string) => name.length > 1 && !NOISE.has(name);

/** Names the hunk used fewer times after than before: the old side of a rename or a replaced call. */
export const removedNames = (hunk: EditHistoryHunk): string[] => {
  const after = counts(hunk.after);

  return [...counts(hunk.before)].flatMap(([name, n]) =>
    meaningful(name) && n > (after.get(name) ?? 0) ? [name] : []
  );
};

/** Names the hunk no longer uses at all: renamed or replaced, not merely used less. */
export const goneNames = (hunk: EditHistoryHunk): string[] => {
  const after = counts(hunk.after);

  return removedNames(hunk).filter((name) => !after.has(name));
};

/** Names the hunk used more times after than before: a new argument, member or prop. */
export const addedNames = (hunk: EditHistoryHunk): string[] => {
  const before = counts(hunk.before);

  return [...counts(hunk.after)].flatMap(([name, n]) =>
    meaningful(name) && n > (before.get(name) ?? 0) ? [name] : []
  );
};

/** Names on both sides of the hunk: the call, tag or object the edit changed in place. */
export const keptNames = (hunk: EditHistoryHunk): string[] => {
  const before = counts(hunk.before);

  return [...counts(hunk.after).keys()].filter((name) => meaningful(name) && before.has(name));
};

const DECLARATION =
  /\b(?:const|let|var|function\*?|class|type|interface|enum)\s+([$A-Z_a-z][$\w]*)/g;

/** Names the text declares with a keyword (not destructuring or parameters). */
export const declaredNames = (text: string): string[] =>
  [...text.matchAll(DECLARATION)].flatMap((match) => (match[1] ? [match[1]] : []));

const IMPORT = /^\s*import\s+(?:type\s+)?([^"';]*?)\s+from\b/gm;

/** Names the text declares or imports: what it binds, rather than uses. */
export const boundNames = (text: string): string[] => [
  ...declaredNames(text),
  ...[...text.matchAll(IMPORT)].flatMap((match) =>
    (match[1] ?? "")
      .replace(/\b[$\w]+\s+as\s+/g, "")
      .split(/[\s,{}*]+/)
      .filter((name) => /^[$A-Z_a-z][$\w]*$/.test(name) && name !== "type")
  ),
];

/** Offsets of the names keyword declarations bind in the buffer. */
export const declarationOffsets = (buffer: string): number[] =>
  [...buffer.matchAll(DECLARATION)].map(
    (match) => match.index + match[0].length - (match[1] ?? "").length
  );

/** Offsets of the keyword declarations of `name` in the buffer. */
export const declarations = (buffer: string, name: string): number[] =>
  [...buffer.matchAll(DECLARATION)].flatMap((match) =>
    match[1] === name ? [match.index + match[0].length - name.length] : []
  );
