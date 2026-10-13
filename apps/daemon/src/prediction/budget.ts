import { countTokens, packContext } from "@polaris/predict";
import { PredictionContextPiece } from "@polaris/protocol";
import type { PredictionContext } from "@polaris/protocol";

/** Shorten at code-point boundaries before passing whole pieces to the shared counter/packer. */
export function boundedPieces(pieces: PredictionContext, budget: number): PredictionContext {
  const output: PredictionContextPiece[] = [];
  let remaining = budget;

  for (const piece of pieces) {
    const room = remaining - countTokens(`${piece.source}\n\n`);

    if (room <= 0) continue;
    const points = Array.from(piece.text);
    let low = 0;
    let high = points.length;

    while (low < high) {
      const mid = Math.ceil((low + high) / 2);

      if (countTokens(points.slice(0, mid).join("")) <= room) low = mid;
      else high = mid - 1;
    }

    const text = points.slice(0, low).join("");

    if (text.length === 0) continue;
    const next = PredictionContextPiece.make({ ...piece, text });
    output.push(next);
    remaining -= countTokens(`${piece.source}\n${text}\n`);
  }

  return packContext(output, budget);
}

export function budgetContext(
  language: PredictionContext,
  outlines: PredictionContext,
  edits: PredictionContext,
  budget: number
) {
  const groups = [
    boundedPieces(
      language.filter((piece) => piece.kind === "definition"),
      800
    ),
    boundedPieces(outlines, 2800),
    boundedPieces(
      language.filter((piece) => piece.kind === "diagnostic"),
      360
    ),
    boundedPieces(edits, 2400),
  ];

  const result: PredictionContextPiece[] = [];
  let remaining = budget;

  for (const group of groups) {
    const packed = boundedPieces(group, remaining);
    result.push(...packed);
    remaining -= packed.reduce(
      (sum, piece) => sum + countTokens(`${piece.source}\n${piece.text}\n`),
      0
    );
  }

  return result;
}
