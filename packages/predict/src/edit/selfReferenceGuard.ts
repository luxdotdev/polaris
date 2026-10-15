const declaration =
  /\b(?:const|let|var)\s+(\{[^}]*\}|\[[^\]]*\]|[\p{L}_$][\p{L}\p{N}_$]*)\s*(?::[^=]*)?=(?!=)(.*)$/u;

const bindings = (pattern: string) => {
  const parts = /^[[{]/.test(pattern) ? pattern.slice(1, -1).split(",") : [pattern];

  return parts.flatMap((part) => {
    const name = (part.split(":").at(-1) ?? "")
      .split("=")[0]
      ?.trim()
      .replace(/^\.\.\./, "");

    return name ? [name] : [];
  });
};

/** Strings, member names, object keys and arrow bodies do not read the binding being declared. */
const reads = (initializer: string) =>
  initializer
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, " ")
    .replace(/\.\s*[\p{L}_$][\p{L}\p{N}_$]*/gu, " ")
    .replace(/[\p{L}_$][\p{L}\p{N}_$]*\s*:/gu, " ")
    .replace(/=>[\s\S]*$/, " ");

const identifier = /[\p{L}_$][\p{L}\p{N}_$]*/gu;

const readsItself = (line: string) => {
  const match = declaration.exec(line);

  if (!match) return false;
  const read = new Set(reads(match[2] ?? "").match(identifier));

  return bindings(match[1] ?? "").some((name) => read.has(name));
};

/** A new `const x = f(x)` line reads its binding before it exists. */
export const readsOwnDeclaration = (before: string, after: string) => {
  const existing = new Set(before.split("\n").map((line) => line.trim()));

  return after.split("\n").some((line) => !existing.has(line.trim()) && readsItself(line));
};
