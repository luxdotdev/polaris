import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type Attempt, type Claim, type Constellation, type Turn } from "@polaris/protocol";
import { Effect, Schema } from "effect";
import { CID, LEAD, HOST, report } from "../engine/constellation.testing.ts";
import { setup, finish } from "../constellation/delivery/testing.ts";
import { Constellations } from "../constellation/service.ts";
import { EventStore } from "../store/EventStore.ts";
import { startPendingAttempt } from "../constellation/composition/workers.ts";
import { McpBinding } from "./binding.ts";
import { type ConstellationCommands } from "./tools.ts";
import { FriendlyReview } from "./tools/inputs.ts";
import { McpTokens } from "./tokens.ts";
import { mcpHttp } from "./http.ts";
import { sendbackWorld } from "./sendback.testing.ts";
import { restartForRetry } from "./sendback.restart.testing.ts";

const reason =
  "  Fix the missing cleanup.\n\nKeep `$(literal)` and Unicode λ verbatim.\n" +
  "Explain the failure and retain both tests.\n".repeat(90) +
  "Trailing spaces stay.  \n";

interface ToolInput {
  claim?: Claim;
  task?: string;
  revision?: number;
  action?: typeof FriendlyReview.Type;
  json?: boolean;
}

const ToolResponse = Schema.Struct({
  result: Schema.Struct({
    isError: Schema.optionalKey(Schema.Boolean),
    content: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
  }),
});

const call = async (
  binding: McpBinding,
  commands: ConstellationCommands,
  name: string,
  input: ToolInput
) => {
  const tokenRoot = mkdtempSync("/tmp/polaris-sendback-mcp-");

  try {
    return await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const tokens = yield* McpTokens;
          const token = yield* tokens.issue(binding);
          const { origin } = yield* mcpHttp(commands);

          const json = yield* Effect.promise(async () => {
            const response = await fetch(`${origin}/mcp/${token}`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "MCP-Protocol-Version": "2025-11-25" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "tools/call",
                params: { name, arguments: input },
              }),
            });

            expect(response.status).toBe(200);

            return response.json();
          });

          const { result } = Schema.decodeUnknownSync(ToolResponse)(json);

          expect(result.isError, JSON.stringify(result.content)).not.toBe(true);

          return result.content.map((c) => c.text).join("\n");
        })
      ).pipe(Effect.provide(McpTokens.layer(join(tokenRoot, "mcp.sqlite"))))
    );
  } finally {
    rmSync(tokenRoot, { recursive: true, force: true });
  }
};

const lead = McpBinding.cases.Lead.make({ sessionId: LEAD, constellationId: CID });

const worker = (attempt: Attempt) =>
  McpBinding.cases.Worker.make({
    sessionId: attempt.sessionId,
    constellationId: CID,
    attemptId: attempt.id,
  });

const assertTurn = (turn: Turn, previous: Attempt, merge: boolean) => {
  expect(turn.prompt).toContain(`Review feedback:\n${reason}`);
  expect(turn.prompt).toContain(JSON.stringify(previous.claim));
  expect(turn.prompt).toContain(previous.claim!.head);

  if (merge)
    expect(turn.prompt).toStartWith(
      "Merge conflict: merge integration-base into your branch first"
    );
};

for (const fresh of [false, true])
  for (const merge of [false, true]) {
    for (const restart of [false, true]) {
      test(`MCP SendBack delivers verbatim feedback: fresh=${fresh}, merge=${merge}, restart=${restart}`, async () => {
        const root = mkdtempSync("/tmp/polaris-sendback-");
        const file = join(root, "state.sqlite");
        const w = sendbackWorld(file, !restart);
        let saved: { graph: Constellation; previous: Attempt; attempt: Attempt };

        try {
          saved = await w.run(
            Effect.gen(function* () {
              yield* setup();
              const commands = yield* Constellations;
              const store = yield* EventStore;
              const initial = (yield* store.model).constellations.get(CID)!.graph.attempts[0]!;

              if (!restart) yield* finish(initial.sessionId);

              yield* Effect.promise(() =>
                call(worker(initial), commands, "claim", { claim: report() })
              );
              const previous = (yield* store.model).constellations.get(CID)!.graph.attempts[0]!;

              yield* Effect.promise(() =>
                call(lead, commands, "review", {
                  task: "A",
                  revision: previous.revision,
                  action: FriendlyReview.cases.SendBack.make({
                    reason,
                    worker: fresh ? { host: HOST } : { session: initial.sessionId },
                    mergeConflictBase: merge ? "integration-base" : null,
                  }),
                })
              );
              const graph = (yield* store.model).constellations.get(CID)!.graph;
              const attempt = graph.attempts.at(-1)!;

              expect(graph.attempts[0]!.rejectionReason).toBe(reason);

              expect(attempt.sessionId === initial.sessionId).toBe(!fresh);

              for (const binding of [lead, worker(attempt)]) {
                const text = yield* Effect.promise(() =>
                  call(binding, commands, "status", { json: true })
                );

                expect(text).toContain(`Claim ${previous.claim!.head}`);

                expect(text).toContain(`Review feedback:\n${reason}`);

                expect(text).toContain(JSON.stringify(reason));
              }

              const turns = (yield* store.model).sessions.get(attempt.sessionId)!.turns;

              if (restart) expect(turns.some((t) => t.id === `${attempt.id}:start`)).toBe(false);
              else assertTurn(turns.at(-1)!, previous, merge);

              return { graph, previous, attempt };
            })
          );

          if (restart) {
            assertTurn(await restartForRetry(root, saved.attempt), saved.previous, merge);
            const resumed = sendbackWorld(file, true);

            await resumed.run(
              Effect.gen(function* () {
                const store = yield* EventStore;
                const graph = (yield* store.model).constellations.get(CID)!.graph;

                expect(graph.attempts[0]!.rejectionReason).toBe(reason);

                yield* startPendingAttempt(graph, saved.attempt);

                yield* startPendingAttempt(graph, saved.attempt);

                const turns = (yield* store.model).sessions.get(saved.attempt.sessionId)!.turns;

                expect(turns.filter((t) => t.id === `${saved.attempt.id}:start`)).toHaveLength(1);

                assertTurn(turns.at(-1)!, saved.previous, merge);

                expect(resumed.turns).toHaveLength(0);
              })
            );
          }
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      }, 20000);
    }
  }
