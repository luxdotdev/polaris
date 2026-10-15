import { counts } from "./novelGuard.ts";
import { lineAt } from "./window.ts";

const trimmed = (source: string) => source.split("\n").map((line) => line.trim());

/** A new line that repeats its neighbour, such as a second identical field or import. */
const repeatsNeighbour = (before: string, after: string) => {
  const was = counts(trimmed(before));
  const lines = trimmed(after);
  const now = counts(lines);

  return lines.some(
    (line, i) =>
      line.length >= 6 &&
      /\p{L}/u.test(line) &&
      (now.get(line) ?? 0) > (was.get(line) ?? 0) &&
      (lines[i - 1] === line || lines[i + 1] === line)
  );
};

const declarations = (source: string) =>
  [...source.matchAll(/\b(?:const|let|var|function|class)\s+([\p{L}_$][\p{L}\p{N}_$]*)/gu)].map(
    (match) => ({ name: match[1] ?? "", line: lineAt(source, match.index) })
  );

/** A second declaration of a name within two lines of another, such as a dangling `const x =`. */
const redeclaresNearby = (before: string, after: string) => {
  const was = counts(declarations(before).map((d) => d.name));
  const now = declarations(after);

  return now.some(
    (d) =>
      now.filter((e) => e.name === d.name).length > (was.get(d.name) ?? 0) &&
      now.some((e) => e !== d && e.name === d.name && Math.abs(e.line - d.line) <= 2)
  );
};

export const duplicates = (before: string, after: string) =>
  repeatsNeighbour(before, after) || redeclaresNearby(before, after);
