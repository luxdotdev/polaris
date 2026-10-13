import { expect, test } from "bun:test";
import { PredictionContextPiece } from "@polaris/protocol";
import { buildPrompt } from "./prompt.ts";
import { countTokens } from "./budget.ts";
import { request } from "./fixtures.testing.ts";

test("Mellum SPM places stable related files and suffix before changing prefix", () => {
  const context = [
    PredictionContextPiece.make({
      kind: "definition",
      source: "types.ts",
      text: "type A = number",
    }),
  ];

  const first = buildPrompt({ ...request, context });
  expect(first.prompt).toBe(
    `<filename>types.ts\ntype A = number\n<filename>math.ts\n<fim_suffix>;\n<fim_prefix>${request.prefix}<fim_middle>`
  );
  const second = buildPrompt({ ...request, context, prefix: `${request.prefix}a` });
  expect(second.prompt.startsWith(first.prompt.slice(0, -"<fim_middle>".length))).toBe(true);
});

test("Qwen FIM uses its own tokens and repository context before the excerpt", () => {
  const context = [
    PredictionContextPiece.make({
      kind: "importOutline",
      source: "types.ts",
      text: "export type A = number",
    }),
  ];

  const value = buildPrompt({ ...request, context, format: "qwen-fim" });
  expect(value.prompt).toBe(
    `<|repo_name|>polaris\n<|file_sep|>types.ts\nexport type A = number\n<|file_sep|>math.ts\n<|fim_prefix|>${request.prefix}<|fim_suffix|>;\n<|fim_middle|>`
  );
  expect(value.stop).toContain("<|fim_pad|>");
});

test("prompt markers, multibyte excerpts and generic suffix fit the full input budget", () => {
  for (const format of ["mellum-spm", "qwen-fim", "suffix"] as const) {
    const value = buildPrompt({
      ...request,
      format,
      budgetTokens: 200,
      prefix: "é😀".repeat(100),
      suffix: "é😀".repeat(100),
    });

    expect(countTokens(value.prompt) + countTokens(value.suffix ?? "")).toBeLessThanOrEqual(200);
    expect(value.prompt).not.toContain("\uFFFD");
  }

  expect(() => buildPrompt({ ...request, budgetTokens: 1 })).toThrow("Prompt markers");
});

test("stable context survives large buffers and a one-character edit", () => {
  const context = [
    PredictionContextPiece.make({ kind: "definition", source: "types.ts", text: "const x=1" }),
  ];

  const first = buildPrompt({ ...request, context, budgetTokens: 160, prefix: "a".repeat(200) });

  const second = buildPrompt({
    ...request,
    context,
    budgetTokens: 160,
    prefix: `${"a".repeat(200)}b`,
  });

  expect(first.prompt.startsWith("<filename>types.ts")).toBe(true);
  expect(second.prompt.startsWith("<filename>types.ts")).toBe(true);
});

test("equivalent context order cannot churn the cache prefix", () => {
  const context = [
    PredictionContextPiece.make({ kind: "definition", source: "b.ts", text: "type B = string" }),
    PredictionContextPiece.make({ kind: "definition", source: "a.ts", text: "type A = number" }),
    PredictionContextPiece.make({
      kind: "importOutline",
      source: "c.ts",
      text: "export const C = 1",
    }),
  ];

  expect(buildPrompt({ ...request, context }).prompt).toBe(
    buildPrompt({ ...request, context: context.toReversed() }).prompt
  );
});
