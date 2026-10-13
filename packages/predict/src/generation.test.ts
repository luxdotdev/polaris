import { expect, test } from "bun:test";
import { Effect, Schema, Stream } from "effect";
import { generationBudget, provisionalLine } from "./generation.ts";
import { createPredictor } from "./predictor.ts";
import { fixtureFetch, request, sse } from "./fixtures.testing.ts";

test("expressions stop at newline with 32 tokens; block openers retain caller limits", () => {
  for (const prefix of ["return ", "const value = ", "obj.", "let x: "])
    expect(generationBudget(prefix, 128, 8)).toEqual({
      maxTokens: 32,
      maxLines: 1,
      singleLine: true,
    });

  for (const prefix of ["function f() {\n  ", "(x) => ", "def f():\n    "])
    expect(generationBudget(prefix, 128, 8)).toEqual({
      maxTokens: 128,
      maxLines: 8,
      singleLine: false,
    });
  expect(generationBudget("return ", 12, 1).maxTokens).toBe(12);
});

test("preview waits for a word boundary, preserves indent and withholds incomplete markers", () => {
  expect(provisionalLine("val")).toBe("");
  expect(provisionalLine("value + par")).toBe("value + ");
  expect(provisionalLine("value;\nnext()")).toBe("value;");
  expect(provisionalLine("\n  return val")).toBe("\n  return ");
  expect(provisionalLine("\n  return value;\nnext()")).toBe("\n  return value;");
  expect(provisionalLine("value;<fim_")).toBe("value;");
  expect(provisionalLine("\r\n  ")).toBe("");
});

test("both endpoints receive a small budget and newline stop; OpenAI requests prompt reuse", async () => {
  for (const kind of ["openai", "ollama"] as const) {
    let body = "";

    const predictor = createPredictor(async (url, init) => {
      body = Schema.decodeUnknownSync(Schema.String)(init.body);

      return fixtureFetch(
        kind === "openai" ? sse("answer\nignored") : '{"response":"answer\\nignored","done":true}\n'
      )(url, init);
    });

    const items = await Effect.runPromise(
      predictor
        .complete({ ...request, prefix: "return ", endpoint: { ...request.endpoint, kind } })
        .pipe(Stream.runCollect)
    );

    expect(body).toContain(kind === "openai" ? '"max_tokens":32' : '"num_predict":32');
    expect(body).toContain('"\\n"');

    if (kind === "openai") expect(body).toContain('"cache_prompt":true');
    expect(items.at(-1)).toMatchObject({ text: "answer" });
  }
});

test("timing observation records prompt, first token once, and final in order", async () => {
  const stages: { stage: string; elapsed: number }[] = [];
  await Effect.runPromise(
    createPredictor(fixtureFetch(sse("one ", false) + sse("two")))
      .complete(request, {
        onTiming: (stage, elapsed) => stages.push({ stage, elapsed }),
      })
      .pipe(Stream.runDrain)
  );
  expect(stages.map((item) => item.stage)).toEqual(["prompt", "firstToken", "final"]);
  expect(stages.map((item) => item.elapsed)).toEqual(
    stages.map((item) => item.elapsed).toSorted((a, b) => a - b)
  );
});
