import type { PredictionContext, PredictionContextPiece } from "@polaris/protocol";
import type { TokenCounter } from "./types.ts";

/** Conservative UTF-8 byte upper bound for byte-level tokenizers, not an exact token count. */
export const countTokens: TokenCounter = (text) => new TextEncoder().encode(text).length;

const priority = { definition: 0, importOutline: 1, editHunk: 2, diagnostic: 3 };

export const orderedContext = (context: PredictionContext): PredictionContext =>
  context.toSorted((a, b) => priority[a.kind] - priority[b.kind]);

/** Fits whole pieces in stable order; prompt construction additionally accounts for format markers. */
export const packContext = (
  context: PredictionContext,
  budgetTokens: number,
  counter: TokenCounter = countTokens
): PredictionContext => {
  const result: PredictionContextPiece[] = [];
  let remaining = Math.max(0, budgetTokens);

  for (const piece of orderedContext(context)) {
    const cost = counter(`${piece.source}\n${piece.text}\n`);

    if (cost > remaining) continue;
    result.push(piece);
    remaining -= cost;
  }

  return result;
};

export const fitText = (
  text: string,
  budget: number,
  tail: boolean,
  counter: TokenCounter
): string => {
  if (counter(text) <= budget) return text;
  const points = Array.from(text);
  let low = 0;
  let high = points.length;

  while (low < high) {
    const size = Math.ceil((low + high) / 2);
    const candidate = (tail ? points.slice(-size) : points.slice(0, size)).join("");

    if (counter(candidate) <= budget) low = size;
    else high = size - 1;
  }

  return low === 0 ? "" : (tail ? points.slice(-low) : points.slice(0, low)).join("");
};
