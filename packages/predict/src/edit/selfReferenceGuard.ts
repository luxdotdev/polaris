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

const readsItself = (line: string) => {
  const match = declaration.exec(line);

  if (!match) return false;
  const initializer = reads(match[2] ?? "");

  return bindings(match[1] ?? "").some((name) =>
    new RegExp(`(?<![\\p{L}\\p{N}_$])${name.replaceAll("$", "\\$")}(?![\\p{L}\\p{N}_$])`, "u").test(
      initializer
    )
  );
};

/** A new `const x = f(x)` line reads its binding before it exists. */
export const readsOwnDeclaration = (before: string, after: string) => {
  const existing = new Set(before.split("\n").map((line) => line.trim()));

  return after.split("\n").some((line) => !existing.has(line.trim()) && readsItself(line));
};
