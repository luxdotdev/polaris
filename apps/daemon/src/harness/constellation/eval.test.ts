import { expect, test } from "bun:test";
import { Claim, PlanOperation, TaskDefinition, TaskId, TurnId } from "@polaris/protocol";
import { Effect, Schema, Stream } from "effect";
import { HarnessEvent } from "../HarnessDriver.ts";
import { makeBenchDriver } from "../bench/BenchDriver.ts";
import { constellationTools, type BoundTool } from "../../mcp/tools.ts";
import { fakeCommands, leadBinding } from "../../mcp/testing.ts";
import { attachConstellation } from "./attachment.ts";
import { McpTokens } from "../../mcp/tokens.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { startWorker } from "./start.ts";
import { assignment } from "./testing.ts";

test("scripted Lead plans and dispatches a small Constellation on the bench Harness", async () => {
  const root = mkdtempSync("/tmp/polaris-c1-eval-");
  const fake = fakeCommands();
  let toolCalls = 0;
  let errors = 0;

  const call = async <A>(tools: ReadonlyArray<BoundTool>, name: string, input: A) => {
    const tool = tools.find((entry) => entry.name === name);

    if (!tool) throw new Error(`Missing ${name}`);

    const result = await tool.call(
      Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(JSON.stringify(input))
    );

    toolCalls++;

    if (result.isError === true) errors++;
  };

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const lead = constellationTools(leadBinding, fake.commands);
          yield* Effect.promise(() =>
            call(lead, "plan", {
              operations: [
                PlanOperation.cases.Add.make({
                  task: new TaskDefinition({
                    id: TaskId.make("A1"),
                    title: "Adapter",
                    kind: "task",
                    brief: "Build the adapter",
                  }),
                }),
                PlanOperation.cases.Add.make({
                  task: new TaskDefinition({
                    id: TaskId.make("A2"),
                    title: "Tests",
                    kind: "task",
                    brief: "Check the adapter",
                  }),
                }),
              ],
            })
          );
          yield* Effect.promise(() =>
            call(lead, "dispatch", {
              tasks: [
                { taskId: "A1", worker: { host: "local" } },
                { taskId: "A2", worker: { host: "local" } },
              ],
            })
          );
          const driver = makeBenchDriver("codex");

          for (const id of ["A1", "A2"]) {
            const original = assignment(id);
            yield* startWorker(original, {
              attach: (binding) =>
                attachConstellation(binding, "http://127.0.0.1:12345", fake.commands).pipe(
                  Effect.orDie
                ),
              startSession: Effect.fnUntraced(function* (start) {
                const session = yield* driver.open({
                  sessionId: start.attachment.sessionId,
                  cwd: root,
                  permissionMode: start.assignment.permissionMode,
                  model: start.assignment.selection.model,
                  effort: start.assignment.selection.effort,
                  resumeCursor: null,
                  constellation: start.attachment,
                });

                yield* session.sendTurn({
                  turnId: TurnId.make(id),
                  prompt: start.prompt,
                  attachments: [],
                  model: null,
                  effort: null,
                });
                yield* session.events.pipe(
                  Stream.takeUntil(HarnessEvent.$is("TurnEnded")),
                  Stream.runDrain
                );
                yield* Effect.promise(() =>
                  call(start.attachment.tools, "claim", {
                    claim: new Claim({
                      branch: start.assignment.attempt.branch,
                      head: `head-${id}`,
                      commits: [`head-${id}`],
                      receipts: [],
                      notDone: [],
                      followups: [],
                      questions: [],
                      outsideArea: [],
                      decisions: [],
                      summary: "Bench Turn completed",
                    }),
                  })
                );
              }),
            });
          }
        })
      ).pipe(Effect.provide(McpTokens.layer(join(root, "tokens.sqlite"))))
    );
    expect({ toolCalls, errors }).toEqual({ toolCalls: 4, errors: 0 });
    expect(fake.calls.map((entry) => entry.command._tag)).toEqual([
      "Plan",
      "Dispatch",
      "WorkerClaim",
      "WorkerClaim",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
