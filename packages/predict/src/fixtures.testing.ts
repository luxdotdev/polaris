import { PredictionRequest } from "@polaris/protocol";
import type { PredictionFetch } from "./endpoint.ts";

export const request = PredictionRequest.make({
  context: [],
  path: "math.ts",
  prefix: "const sum = (a: number, b: number) => ",
  suffix: ";\n",
  model: "mellum2-12b-a2.5b",
  format: "mellum-spm",
  endpoint: { kind: "openai", url: "http://127.0.0.1:8080" },
  budgetTokens: 2048,
  maxTokens: 64,
  maxLines: 8,
});

export const fixtureFetch =
  (data: string, width = 1): PredictionFetch =>
  async () => {
    const bytes = new TextEncoder().encode(data);
    let offset = 0;

    return new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= bytes.length) {
            controller.close();

            return;
          }

          controller.enqueue(bytes.slice(offset, offset + width));
          offset += width;
        },
      })
    );
  };

export const sse = (text: string, done = true) =>
  `data: ${JSON.stringify({ choices: [{ text, finish_reason: null }] })}\r\n\r\n${done ? "data: [DONE]\r\n\r\n" : ""}`;
