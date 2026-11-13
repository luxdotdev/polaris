/**
 * The fingerprint of one line of code (ADR 0111): whitespace-normalised, then hashed. Lines
 * with fewer than `MIN_MEANINGFUL` letters and digits are too common to identify a Turn.
 */
import { createHash } from "node:crypto";

/** `return null;` (10) and `} else {` (4) fall short; `return result;` (12) counts. */
export const MIN_MEANINGFUL = 12;

const MEANINGFUL = /[\p{L}\p{N}]/gu;

/** Trimmed, with each run of whitespace collapsed to one space. */
export const normaliseLine = (line: string): string => line.trim().replace(/\s+/g, " ");

/** Null for a line too short or common to identify; else 32 hex characters of its SHA-256. */
export const lineHash = (line: string): string | null => {
  const normalised = normaliseLine(line);

  if ((normalised.match(MEANINGFUL)?.length ?? 0) < MIN_MEANINGFUL) return null;

  return createHash("sha256").update(normalised).digest("hex").slice(0, 32);
};
