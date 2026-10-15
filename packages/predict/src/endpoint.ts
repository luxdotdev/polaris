import {
  PredictionError,
  type EditPredictionRequest,
  type PredictionRequest,
} from "@polaris/protocol";
import { Schema } from "effect";
import { records } from "./records.ts";
import type { PredictionPrompt } from "./prompt.ts";

type EndpointRequest = PredictionRequest | EditPredictionRequest;

interface OpenAiBody {
  model: string;
  prompt: string;
  suffix?: string;
  stream: boolean;
  cache_prompt: boolean;
  temperature: number;
  max_tokens: number;
  stop: readonly string[];
}

export type PredictionFetch = (url: string, init: RequestInit) => Promise<Response>;

const OpenAiChunk = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      text: Schema.optional(Schema.String),
      finish_reason: Schema.optional(Schema.NullOr(Schema.String)),
    })
  ),
});

const OllamaChunk = Schema.Struct({
  response: Schema.String,
  done: Schema.Boolean,
  done_reason: Schema.optional(Schema.String),
});

const decodeOpenAi = Schema.decodeUnknownSync(Schema.fromJsonString(OpenAiChunk));

const decodeOllama = Schema.decodeUnknownSync(Schema.fromJsonString(OllamaChunk));

export const endpointUrl = (request: EndpointRequest): string => {
  const url = new URL(request.endpoint.url);

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new PredictionError({
      reason: "invalid-request",
      message: "Use an HTTP endpoint without credentials, query or fragment",
    });
  }

  const path = url.pathname.replace(/\/$/, "");
  url.pathname =
    request.endpoint.kind === "ollama"
      ? `${path}/api/generate`
      : `${path.endsWith("/v1") ? path : `${path}/v1`}/completions`;

  return url.href;
};

const requestBody = (request: EndpointRequest, prompt: PredictionPrompt) => {
  if (request.endpoint.kind === "ollama") {
    if (request.format === "suffix")
      throw new PredictionError({
        reason: "invalid-request",
        message: "Suffix format requires an OpenAI-compatible endpoint",
      });

    return {
      model: request.model,
      prompt: prompt.prompt,
      raw: true,
      stream: true,
      options: { temperature: 0, num_predict: request.maxTokens, stop: prompt.stop },
    };
  }

  const body: OpenAiBody = {
    model: request.model,
    prompt: prompt.prompt,
    stream: true,
    temperature: 0,
    max_tokens: request.maxTokens,
    cache_prompt: true,
    stop: prompt.stop,
  };

  if (prompt.suffix !== undefined) body.suffix = prompt.suffix;

  return body;
};

function parseChunk(data: string, ollama: boolean) {
  try {
    if (ollama) {
      const chunk = decodeOllama(data);

      return { text: chunk.response, done: chunk.done, truncated: chunk.done_reason === "length" };
    }

    if (data === "[DONE]") return { text: "", done: true, truncated: false };
    const chunk = decodeOpenAi(data);

    return {
      text: chunk.choices[0]?.text ?? "",
      done: chunk.choices.some((choice) => choice.finish_reason != null),
      truncated: chunk.choices.some((choice) => choice.finish_reason === "length"),
    };
  } catch {
    throw new PredictionError({
      reason: "invalid-response",
      message: "Malformed completion stream",
    });
  }
}

export async function* endpointDeltas(
  request: EndpointRequest,
  prompt: PredictionPrompt,
  signal: AbortSignal,
  fetcher: PredictionFetch
) {
  const response = await fetcher(endpointUrl(request), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: request.endpoint.kind === "ollama" ? "application/x-ndjson" : "text/event-stream",
    },
    body: JSON.stringify(requestBody(request, prompt)),
    signal,
    redirect: "error",
    credentials: "omit",
  });

  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new PredictionError({
      reason: "endpoint-failed",
      message: `Completion endpoint returned HTTP ${response.status}`,
    });
  }

  for await (const record of records(response.body, request.endpoint.kind === "ollama", signal)) {
    signal.throwIfAborted();
    const chunk = parseChunk(record, request.endpoint.kind === "ollama");

    if (chunk.truncated && "buffer" in request)
      throw new PredictionError({
        reason: "invalid-response",
        message: "Edit prediction exhausted its output budget",
      });

    if (chunk.text) yield chunk.text;

    if (chunk.done) return;
  }

  throw new PredictionError({
    reason: "invalid-response",
    message: "Completion stream ended before its final record",
  });
}
