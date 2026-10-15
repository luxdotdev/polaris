/** Whether a language server's diagnostic says a name is not in scope, the cue for an import fix. */
import { Predicate } from "effect";

export interface DiagnosticCue {
  readonly code: string | number | null;
  readonly message: string;
  readonly severity: 1 | 2 | 3 | 4 | null;
}

/**
 * TypeScript (2304, 2552, 2503, 18004), Rust (E0405, E0412, E0422, E0425, E0433, E0531),
 * Pyright, Ruff and gopls codes for a name that is not in scope.
 */
const CODES = new Set<string | number>([
  2304,
  2552,
  2503,
  18004,
  "E0405",
  "E0412",
  "E0422",
  "E0425",
  "E0433",
  "E0531",
  "reportUndefinedVariable",
  "F821",
  "UndeclaredName",
]);

const MESSAGES =
  /cannot find (?:name|symbol|value|type|trait|macro|function|namespace)\b|\bundefined: |\bundefined (?:name|variable|identifier)\b|\bundeclared (?:name|identifier)\b|\bis not defined\b|\bunresolved (?:name|reference|identifier)\b|cannot be resolved/i;

export const isUnresolvedName = (diagnostic: DiagnosticCue): boolean => {
  if (diagnostic.severity === 3 || diagnostic.severity === 4) return false;

  if (diagnostic.code !== null && CODES.has(diagnostic.code)) return true;

  if (Predicate.isString(diagnostic.code) && CODES.has(Number(diagnostic.code))) return true;

  return MESSAGES.test(diagnostic.message);
};
