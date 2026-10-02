import { Effect, Layer } from "effect";
import { ConstellationId } from "@polaris/protocol";
import { attachConstellation } from "../../harness/constellation/index.ts";
import { McpBinding } from "../../mcp/binding.ts";
import { McpTokens } from "../../mcp/tokens.ts";
import type { ConstellationCommands } from "../../mcp/tools.ts";
import { EventStore } from "../../store/EventStore.ts";
import type { ReadModel } from "../../store/model.ts";
import type { SessionId } from "@polaris/protocol";
import { ConstellationOwner } from "../runtime.ts";
import { TransferStorage } from "../transfers/storage.ts";
import { workerEnvironment } from "../host.ts";

import { ConstellationHarness, type ConstellationHarnessDelegate } from "./attachments.ts";

const plainBinding = (model: ReadModel, sessionId: SessionId): ReadonlyArray<McpBinding> => {
  const session = model.sessions.get(sessionId)?.session;

  return session === undefined || session.state === "archived"
    ? []
    : [
        McpBinding.cases.Plain.make({
          sessionId,
          constellationId: ConstellationId.make(crypto.randomUUID()),
          workspaceId: session.workspaceId,
        }),
      ];
};

export const attachmentProvider = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* EventStore;
    const storage = yield* TransferStorage;
    const owner = yield* ConstellationOwner;
    const tokens = yield* McpTokens;
    let endpoint: { origin: string; commands: ConstellationCommands } | undefined;

    const delegate: ConstellationHarnessDelegate = {
      install: (origin, commands) =>
        Effect.sync(() => {
          endpoint = { origin, commands };
        }),
      open: Effect.fnUntraced(function* (sessionId) {
        const bindings: Array<McpBinding> = [];
        const model = yield* store.model;
        let worker: import("@polaris/protocol").Attempt | undefined;

        for (const record of model.constellations.values()) {
          const graph = record.graph;

          if (graph.hostId !== owner || graph.state === "archived" || graph.state === "completed")
            continue;

          if (graph.leadSessionId === sessionId)
            bindings.push(McpBinding.cases.Lead.make({ sessionId, constellationId: graph.id }));

          const attempt = graph.attempts.findLast(
            (a) => a.sessionId === sessionId && (a.state === "working" || a.state === "review")
          );

          if (attempt !== undefined) {
            worker = attempt;
            bindings.push(
              McpBinding.cases.Worker.make({
                sessionId,
                constellationId: graph.id,
                attemptId: attempt.id,
              })
            );
          }
        }

        for (const assignment of yield* storage.assignments.pipe(Effect.orDie)) {
          const attempt = assignment.graph.attempts.find((a) => a.id === assignment.attemptId);

          if (
            attempt?.sessionId !== sessionId ||
            (attempt.state !== "working" && attempt.state !== "review") ||
            assignment.graph.state === "archived"
          )
            continue;
          worker = attempt;
          bindings.push(
            McpBinding.cases.Worker.make({
              sessionId,
              constellationId: assignment.graph.id,
              attemptId: attempt.id,
            })
          );
        }

        if (bindings.length === 0) bindings.push(...plainBinding(model, sessionId));

        const installed = endpoint;

        const constellations =
          installed === undefined
            ? []
            : yield* Effect.forEach(bindings, (binding) =>
                attachConstellation(binding, installed.origin, installed.commands).pipe(
                  Effect.provideService(McpTokens, tokens),
                  Effect.orDie
                )
              );

        return {
          constellations,
          environment: worker === undefined ? {} : workerEnvironment(worker),
        };
      }),
    };

    yield* (yield* ConstellationHarness).activate(delegate);
  })
);
