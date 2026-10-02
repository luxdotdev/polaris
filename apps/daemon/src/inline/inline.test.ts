import { expect, test } from "bun:test";
import { InlinePatch, InlineStreamItem } from "@polaris/protocol";
import { Deferred, Effect, Fiber, Stream, Predicate, Result } from "effect";
import { benchInline } from "./bench.ts";
import type { InlineBackend } from "./backend.ts";
import { propose } from "./proposal.ts";

import { request } from "./testing.ts";

const patch = InlinePatch.make({
  replacements: [{ from: 7, to: 9, text: "ok" }],
  summary: "Replace emoji",
});

test("scripted Harness streams progress and one validated final patch with timing", async () => {
  const input = request(`bench:${JSON.stringify({ patch })}`);

  const items = await Effect.runPromise(
    propose(input, "/repo", benchInline).pipe(Stream.runCollect)
  );

  expect(items).toHaveLength(2);
  expect(items[0]).toEqual(
    InlineStreamItem.cases.Delta.make({ text: "Preparing a scripted proposal" })
  );
  expect(items[1]).toMatchObject({ patch });
  expect(Predicate.isTagged(items[1], "Proposed") && items[1].thoughtMs).toBeGreaterThanOrEqual(0);
});

test("rejects malformed schema, out-of-selection ranges, overlap and surrogate splits", async () => {
  const invalid = [
    { replacements: [], summary: "" },
    { replacements: [{ from: 6, to: 9, text: "x" }], summary: "Edit" },
    {
      replacements: [
        { from: 7, to: 9, text: "x" },
        { from: 8, to: 9, text: "y" },
      ],
      summary: "Edit",
    },
    { replacements: [{ from: 8, to: 9, text: "x" }], summary: "Edit" },
    {
      replacements: [
        { from: 7, to: 7, text: "x" },
        { from: 7, to: 7, text: "y" },
      ],
      summary: "Edit",
    },
  ];

  for (const candidate of invalid) {
    const outcome = await Effect.runPromise(
      propose(request(`bench:${JSON.stringify({ patch: candidate })}`), "/repo", benchInline).pipe(
        Stream.runCollect,
        Effect.result
      )
    );

    expect(Result.isFailure(outcome) && outcome.failure.reason).toBe("invalid-patch");
  }
});

test("invalid selection never starts a Harness", async () => {
  let started = false;

  const backend: InlineBackend = () =>
    Effect.sync(() => {
      started = true;

      return patch;
    });

  const outcome = await Effect.runPromise(
    propose({ ...request(), selection: { from: 8, to: 9 } }, "/repo", backend).pipe(
      Stream.runCollect,
      Effect.result
    )
  );

  expect(Result.isFailure(outcome) && outcome.failure.reason).toBe("invalid-request");
  expect(started).toBe(false);
});

test("cancelling stream consumption interrupts the Harness and runs cleanup", async () => {
  let cleaned = false;

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();

        const backend: InlineBackend = () =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                cleaned = true;
              })
            );

            yield* Deferred.succeed(started, undefined);

            return yield* Effect.never;
          });

        const fiber = yield* Effect.forkScoped(
          propose(request(), "/repo", backend).pipe(Stream.runDrain)
        );

        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
      })
    )
  );

  expect(cleaned).toBe(true);
});
