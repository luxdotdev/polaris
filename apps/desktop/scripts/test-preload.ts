/**
 * Desktop test preload: the Client's copy reads as macOS on every runner, Vite's `?worker`
 * imports load as a Worker that can't start (tests parse on the main thread), happy-dom
 * never replaces Bun's fetch primitives, which main-process tests serve and read, and the DOM
 * exists before any test file loads, whatever order the runner's filesystem lists them in.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { plugin } from "bun";
import { join } from "node:path";
import { pinTestPlatform } from "../src/shared/platform.ts";

pinTestPlatform("darwin");

plugin({
  name: "vite-worker-stub",
  setup(build) {
    build.onResolve({ filter: /\?worker$/ }, () => ({
      path: join(import.meta.dir, "testWorkerStub.ts"),
    }));
  },
});

const native = {
  fetch: globalThis.fetch,
  Request: globalThis.Request,
  Response: globalThis.Response,
  Headers: globalThis.Headers,
  AbortController: globalThis.AbortController,
  AbortSignal: globalThis.AbortSignal,
  ReadableStream: globalThis.ReadableStream,
  Blob: globalThis.Blob,
  FormData: globalThis.FormData,
};

const register = GlobalRegistrator.register.bind(GlobalRegistrator);

GlobalRegistrator.register = (...args: Parameters<typeof GlobalRegistrator.register>) => {
  register(...args);

  Object.assign(globalThis, native);
};

// Before any test file loads: Radix and react-dom check for a DOM once, when their modules load.
GlobalRegistrator.register();
