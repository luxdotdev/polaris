/**
 * Desktop test preload: the Client's copy reads as macOS on every runner, and Vite's
 * `?worker` imports load as a Worker that can't start (tests parse on the main thread).
 */
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
