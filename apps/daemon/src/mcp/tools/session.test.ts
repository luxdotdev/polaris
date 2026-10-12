import { expect, test } from "bun:test";
import { BackgroundTask, ConstellationResult, SessionId, TurnItem } from "@polaris/protocol";
import { Effect, Schema } from "effect";
import { dispatched } from "../../engine/constellation.testing.ts";
import { fakeCommands, leadBinding, workerBinding } from "../testing.ts";
import {
  NotifyOutcome,
  WaitOutcome,
  type SessionTools,
  type WaitOptions,
} from "../sessions/index.ts";
import { attachSessionTools, constellationTools } from "./index.ts";

const json = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

const record = dispatched();

/** A Lead whose status shows one working Attempt, `a1` in session `worker`. */
const world = (sessions: Partial<SessionTools>) => {
  const fake = fakeCommands();
  const reads: Array<{ sessionId: string; turns: number; since: number | null }> = [];
  const waits: Array<WaitOptions> = [];
  const notes: Array<{ title: string; body: string; id: string }> = [];

  const commands = {
    ...fake.commands,
    status: () =>
      Effect.succeed(
        new ConstellationResult({
          summary: "Status.",
          next: "Wait.",
          revision: 3,
          sequence: null,
          constellation: record.graph,
        })
      ),
    resolve: () => Effect.succeed("a1"),
  };

  attachSessionTools(commands, {
    transcript: (sessionId, options) =>
      Effect.sync(() => {
        reads.push({ sessionId, ...options });

        return "# worker\n## Turn 1 · working";
      }),
    waitForCommand: (_id, options) =>
      Effect.sync(() => {
        waits.push(options);

        return WaitOutcome.Idle({ task: null });
      }),
    notify: (_id, input, id) =>
      Effect.sync(() => {
        notes.push({ ...input, id });

        return NotifyOutcome.Sent();
      }),
    ...sessions,
  });

  return { commands, reads, waits, notes };
};

const call = (
  tools: ReturnType<typeof constellationTools>,
  name: string,
  input: Readonly<Record<string, typeof Schema.Json.Type>>
) => {
  const tool = tools.find((entry) => entry.name === name);

  if (!tool) throw new Error(`No ${name} tool`);

  return tool.call(json(JSON.stringify(input)));
};

test("read_worker is the Lead's alone; every catalog can wait", () => {
  const { commands } = world({});
  const lead = constellationTools(leadBinding, commands).map((t) => t.name);
  const worker = constellationTools(workerBinding, commands).map((t) => t.name);

  expect(lead).toContain("read_worker");
  expect(worker).not.toContain("read_worker");
  expect(lead).toContain("wait_for_command");
  expect(worker).toContain("wait_for_command");
});

test("read_worker resolves the Task to its Attempt's session and pages with since", async () => {
  const { commands, reads } = world({});
  const tools = constellationTools(leadBinding, commands);
  const result = await call(tools, "read_worker", { task: "A", turns: 3, since: 2 });

  expect(result.isError).toBeUndefined();
  expect(result.content[0]?.text).toContain("Task A · Attempt a1");
  expect(result.content[0]?.text).toContain("## Turn 1 · working");
  expect(reads).toEqual([{ sessionId: SessionId.make("worker"), turns: 3, since: 2 }]);
  expect((await call(tools, "read_worker", { task: "A", turns: 11 })).isError).toBe(true);
});

test("read_worker says so when the worker's session is on another Host", async () => {
  const { commands } = world({ transcript: () => Effect.succeed(null) });

  const result = await call(constellationTools(leadBinding, commands), "read_worker", {
    task: "A",
  });

  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain("E-NOT-HERE");
});

test("wait_for_command caps its wait under the Harness's tool timeout", async () => {
  const { commands, waits } = world({});
  const tools = constellationTools(workerBinding, commands);

  expect((await call(tools, "wait_for_command", { timeoutSeconds: 51 })).isError).toBe(true);
  await call(tools, "wait_for_command", {});
  await call(tools, "wait_for_command", { task: "c1", timeoutSeconds: 5 });

  expect(waits).toEqual([
    { task: null, timeoutMs: 45_000 },
    { task: "c1", timeoutMs: 5_000 },
  ]);
});

test("wait_for_command reports finished output and what still runs", async () => {
  const finished = world({
    waitForCommand: () =>
      Effect.succeed(
        WaitOutcome.Finished({
          finished: [
            {
              task: new BackgroundTask({ id: "c1", kind: "command", description: "bun test" }),
              command: TurnItem.cases.CommandExecution.make({
                id: "c1",
                startedAt: null,
                command: "bun test",
                cwd: "/tmp",
                output: "12 pass\n0 fail",
                exitCode: 0,
                status: "completed",
              }),
            },
          ],
        })
      ),
  });

  const running = world({
    waitForCommand: () =>
      Effect.succeed(
        WaitOutcome.Running({
          running: [new BackgroundTask({ id: "c2", kind: "command", description: "bun dev" })],
        })
      ),
  });

  const done = await call(
    constellationTools(workerBinding, finished.commands),
    "wait_for_command",
    {}
  );

  const still = await call(
    constellationTools(workerBinding, running.commands),
    "wait_for_command",
    {
      timeoutSeconds: 3,
    }
  );

  expect(done.content[0]?.text).toBe(
    "Finished: bun test (exit 0)\n12 pass\n0 fail\nNext: Continue with the results."
  );
  expect(still.content[0]?.text).toBe(
    "Still running after 3s:\n- c2: bun dev\nNext: Call wait_for_command again to keep waiting, or continue other work."
  );
});

test("notify is in every catalog, keyed like the other mutating tools", async () => {
  const { commands, notes } = world({});
  const tools = constellationTools(workerBinding, commands);
  const note = { title: "Tests pass", body: "Ready for review", requestId: "n-1" };

  await call(tools, "notify", note);
  await call(tools, "notify", note);
  await call(tools, "notify", { title: "Untitled body" });

  expect(constellationTools(leadBinding, commands).map((t) => t.name)).toContain("notify");
  expect(notes.map((n) => n.title)).toEqual(["Tests pass", "Tests pass", "Untitled body"]);
  expect(notes[1]?.id).toBe(notes[0]?.id ?? "");
  expect(notes[2]?.body).toBe("");
  expect((await call(tools, "notify", { title: "" })).isError).toBe(true);
  expect((await call(tools, "notify", { title: "x".repeat(81) })).isError).toBe(true);
});

test("a rate-limited notify says when to try again", async () => {
  const { commands } = world({
    notify: () => Effect.succeed(NotifyOutcome.RateLimited({ retryInSeconds: 12 })),
  });

  const result = await call(constellationTools(workerBinding, commands), "notify", {
    title: "Again",
  });

  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain("notify again in 12s");
});
