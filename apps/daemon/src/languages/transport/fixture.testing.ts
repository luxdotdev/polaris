import { LspFramer } from "./framing.ts";
import type { ProcessPort } from "./index.ts";
import type { LanguageJsonRpcEnvelope } from "@polaris/protocol";

export function memoryPort(blocked = false) {
  const messages: LanguageJsonRpcEnvelope[] = [];
  let output: ReadableStreamDefaultController<Uint8Array> | undefined;
  let release: () => void = () => {};

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  let stopped = false;

  const port: ProcessPort = {
    stdout: new ReadableStream({
      start: (controller) => {
        output = controller;
      },
    }),
    stderr: new ReadableStream({ start: (controller) => controller.close() }),
    exited: Promise.resolve(0),
    pid: 0,
    write: async (bytes) => {
      if (blocked) await gate;
      messages.push(...new LspFramer().push(bytes));
    },
    stop: () => {
      stopped = true;
      release();

      return Promise.resolve();
    },
  };

  return {
    port,
    messages,
    release,
    emit: (bytes: Uint8Array) => output?.enqueue(bytes),
    stopped: () => stopped,
  };
}
