import { PredictionError, type PredictionContext, type PredictionRequest } from "@polaris/protocol";
import { countTokens, fitText, orderedContext } from "./budget.ts";
import type { TokenCounter } from "./types.ts";

export interface PredictionPrompt {
  readonly prompt: string;
  readonly suffix?: string;
  readonly stop: readonly string[];
}

const mellumStops = [
  "<|endoftext|>",
  "<filename>",
  "<fim_prefix>",
  "<fim_suffix>",
  "<fim_middle>",
  "<fim_pad>",
];

const qwenStops = [
  "<|endoftext|>",
  "<|file_sep|>",
  "<|fim_prefix|>",
  "<|fim_suffix|>",
  "<|fim_middle|>",
  "<|fim_pad|>",
  "<|repo_name|>",
];

const render = (
  request: PredictionRequest,
  context: PredictionContext,
  prefix: string,
  suffix: string
): PredictionPrompt => {
  switch (request.format) {
    case "mellum-spm":
      return {
        prompt:
          context.map((p) => `<filename>${p.source}\n${p.text}\n`).join("") +
          `<filename>${request.path}\n<fim_suffix>${suffix}<fim_prefix>${prefix}<fim_middle>`,
        stop: mellumStops,
      };
    case "qwen-fim":
      return {
        prompt:
          (context.length
            ? `<|repo_name|>polaris\n${context.map((p) => `<|file_sep|>${p.source}\n${p.text}\n`).join("")}<|file_sep|>${request.path}\n`
            : "") + `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`,
        stop: qwenStops,
      };
    case "suffix":
      return {
        prompt: context.map((p) => `${p.source}\n${p.text}\n`).join("") + prefix,
        suffix,
        stop: [],
      };
  }
};

/** Input budget includes every marker and suffix; generation uses its separate maxTokens budget. */
export const buildPrompt = (
  request: PredictionRequest,
  counter: TokenCounter = countTokens
): PredictionPrompt => {
  const size = (value: PredictionPrompt) => counter(value.prompt) + counter(value.suffix ?? "");
  const overhead = size(render(request, [], "", ""));

  if (overhead > request.budgetTokens)
    throw new PredictionError({
      reason: "invalid-request",
      message: "Prompt markers exceed the input budget",
    });
  const context: PredictionContext[number][] = [];
  const contextBudget = Math.floor((request.budgetTokens - overhead) / 2);

  for (const piece of orderedContext(request.context)) {
    if (size(render(request, [...context, piece], "", "")) - overhead <= contextBudget)
      context.push(piece);
  }

  const available = request.budgetTokens - size(render(request, context, "", ""));
  const suffix = fitText(request.suffix, Math.floor(available / 3), false, counter);
  const prefix = fitText(request.prefix, available - counter(suffix), true, counter);
  const built = render(request, context, prefix, suffix);

  if (size(built) > request.budgetTokens)
    throw new PredictionError({
      reason: "invalid-request",
      message: "Prompt exceeds the input budget",
    });

  return built;
};
