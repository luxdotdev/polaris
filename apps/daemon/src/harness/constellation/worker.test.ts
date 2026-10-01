import { expect, test } from "bun:test";
import { HarnessSelection, ModelId } from "@polaris/protocol";
import { assignment } from "./testing.ts";
import { Effect } from "effect";
import { startWorker } from "./start.ts";
import { constellationInstructions } from "./skills.ts";
import { selectWorker, type WorkerStart } from "./worker.ts";

test("worker selection uses dispatch, Task, Constellation then user, without cross-Harness defaults", () => {
  const user = { harness: "claude", model: ModelId.make("Opus"), effort: "high" };

  const defaults = new HarnessSelection({
    harness: "codex",
    model: ModelId.make("Sol"),
    effort: "high",
  });

  const task = new HarnessSelection({ model: ModelId.make("Luna"), effort: "medium" });
  expect(selectWorker(new HarnessSelection({ effort: "low" }), task, defaults, user)).toEqual({
    harness: "codex",
    model: "Luna",
    effort: "low",
  });
  expect(selectWorker(null, null, defaults, user)).toEqual({
    harness: "codex",
    model: "Sol",
    effort: "high",
  });
  expect(selectWorker(null, null, null, user)).toEqual(user);
  expect(selectWorker(new HarnessSelection({ harness: "claude" }), null, defaults, user)).toEqual(
    user
  );
});

test("worker startup sends the header, dependency Claims and brief as the first Turn, with user permissions", async () => {
  const starts: WorkerStart[] = [];
  const task = assignment();
  await Effect.runPromise(
    startWorker(task, {
      attach: (binding) =>
        Effect.succeed({
          sessionId: binding.sessionId,
          instructions: constellationInstructions(binding),
          url: "http://127.0.0.1:12345/mcp/test",
          tools: [],
        }),
      startSession: (start) =>
        Effect.sync(() => {
          starts.push(start);
        }),
    })
  );
  expect(starts).toHaveLength(1);
  const start = starts[0]!;
  expect(start.title).toBe("A1 · Build the Harness");
  expect(start.prompt).toStartWith("Polaris assignment");
  expect(start.prompt).toContain("Area: apps/daemon/src/harness/**");
  expect(start.prompt).toContain("Branch: polaris/c1/A1-harness");
  expect(start.prompt).toContain("Base: base-sha");
  expect(start.prompt).toContain('"head":"dep-head"');
  expect(start.prompt).toEndWith("Implement the assigned adapter.");
  expect(start.assignment.permissionMode).toBe("supervised");
});
