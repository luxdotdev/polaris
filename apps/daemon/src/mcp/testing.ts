import {
  AttemptId,
  ConstellationId,
  ConstellationResult,
  SessionId,
  type ConstellationCommand,
} from "@polaris/protocol";
import { Effect } from "effect";
import { McpBinding, type SessionBinding } from "./binding.ts";
import type { ConstellationCommands } from "./tools.ts";

export const workerBinding = McpBinding.cases.Worker.make({
  sessionId: SessionId.make("worker-1"),
  constellationId: ConstellationId.make("c1"),
  attemptId: AttemptId.make("attempt-1"),
});

export const leadBinding = McpBinding.cases.Lead.make({
  sessionId: SessionId.make("lead-1"),
  constellationId: ConstellationId.make("c1"),
});

export const fakeCommands = () => {
  const calls: Array<{ binding: SessionBinding; command: ConstellationCommand }> = [];
  const references: Array<string> = [];

  const result = new ConstellationResult({
    summary: "Recorded.",
    next: "Review the Claim.",
    revision: 7,
    sequence: null,
  });

  const commands: ConstellationCommands = {
    command: (binding, _id, command) =>
      Effect.sync(() => {
        calls.push({ binding, command });

        return result;
      }),
    status: () => Effect.succeed(result),
    resolve: (_binding, _id, kind, name) =>
      Effect.sync(() => {
        references.push(`${kind}:${name}`);

        return `${kind}-${name}`;
      }),
  };

  return { commands, calls, references };
};
