import { expect, test } from "bun:test";
import { countTokens, fitText, packContext } from "./budget.ts";
import { PredictionContextPiece } from "@polaris/protocol";

const piece = (kind: PredictionContextPiece["kind"], text: string) =>
  PredictionContextPiece.make({ kind, text, source: "a.ts" });

test("packing prioritizes stable whole pieces and skips oversized ones", () => {
  const definition = piece("definition", "const x = 1");
  const outline = piece("importOutline", "import x");
  const edit = piece("editHunk", "+ x");
  const diagnostic = piece("diagnostic", "bad");
  const context = [diagnostic, edit, outline, piece("definition", "x".repeat(500)), definition];
  expect(packContext(context, 35)).toEqual([definition, outline]);
  expect(packContext(context, 100)).toEqual([definition, outline, edit, diagnostic]);
  expect(packContext(context, 0)).toEqual([]);
  expect(context[0]).toBe(diagnostic);
});

test("default counts UTF-8 bytes and excerpt trimming preserves code points", () => {
  expect(countTokens("😀éa")).toBe(7);
  expect(fitText("a😀é", 5, true, countTokens)).toBe("é");
  expect(fitText("a😀é", 5, false, countTokens)).toBe("a😀");
  expect(fitText("a😀é", 0, true, countTokens)).toBe("");
});

test("custom tokenizer counter controls context packing", () => {
  const definition = piece("definition", "some code");
  expect(packContext([definition], 1, () => 1)).toEqual([definition]);
});
