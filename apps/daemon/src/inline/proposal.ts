import { isAbsolute, relative, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { InlineError, InlineStreamItem, type InlineRequest } from "@polaris/protocol";
import { Effect, Queue, Stream } from "effect";
import { HarnessRegistry } from "../services.ts";
import { EventStore } from "../store/EventStore.ts";
import type { InlineBackend } from "./backend.ts";
import { validatePatch, validateSelection } from "./patch.ts";

export const propose = (request: InlineRequest, cwd: string, backend: InlineBackend) =>
  Stream.callback<InlineStreamItem, InlineError>(
    (queue) =>
      Effect.gen(function* () {
        const started = performance.now();

        const run = Effect.gen(function* () {
          yield* validateSelection(request);

          const patch = yield* backend(request, cwd, (text) =>
            Queue.offer(queue, InlineStreamItem.cases.Delta.make({ text })).pipe(Effect.asVoid)
          );

          yield* validatePatch(request, patch);

          yield* Queue.offer(
            queue,
            InlineStreamItem.cases.Proposed.make({
              patch,
              thoughtMs: Math.max(0, Math.round(performance.now() - started)),
            })
          );
        }).pipe(
          Effect.matchCauseEffect({
            onFailure: (cause) => Queue.failCause(queue, cause),
            onSuccess: () => Queue.end(queue),
          })
        );

        yield* Effect.forkScoped(run);
      }),
    { bufferSize: 32 }
  );

const contained = (cwd: string, path: string) => {
  const child = relative(cwd, path);

  return child !== ".." && !child.startsWith("../") && !isAbsolute(child);
};

const requestContext = Effect.fn("inline.requestContext")(function* (request: InlineRequest) {
  const store = yield* EventStore;
  const workspace = (yield* store.model).workspaces.get(request.workspaceId);

  if (!workspace)
    return yield* new InlineError({ reason: "invalid-request", message: "Workspace not found" });

  const canonical = yield* Effect.tryPromise({
    try: async () => ({
      cwd: await realpath(workspace.path),
      path: await realpath(resolve(workspace.path, request.path)),
    }),
    catch: () =>
      new InlineError({
        reason: "invalid-request",
        message: "The file must exist in this workspace",
      }),
  });

  if (!contained(canonical.cwd, canonical.path))
    return yield* new InlineError({
      reason: "invalid-request",
      message: "The file is outside this workspace",
    });

  const registry = yield* HarnessRegistry;

  const driver = yield* registry.get(request.harness).pipe(
    Effect.mapError(
      () =>
        new InlineError({
          reason: "harness-failed",
          message: "Harness not available on this host",
        })
    )
  );

  if (!(yield* driver.probe).available)
    return yield* new InlineError({
      reason: "harness-failed",
      message: "Harness not installed on this host",
    });

  const backend: InlineBackend = yield* Effect.promise(async () =>
    process.env.POLARIS_BENCH_HARNESS === "1"
      ? (await import("./bench.ts")).benchInline
      : (await import("./live.ts")).liveInline
  );

  return { request: { ...request, path: canonical.path }, cwd: canonical.cwd, backend };
});

export const handleInline = (request: InlineRequest) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const context = yield* requestContext(request);

      return propose(context.request, context.cwd, context.backend);
    })
  );
