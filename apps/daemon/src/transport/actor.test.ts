import { expect, test } from "bun:test";
import { SessionId } from "@polaris/protocol";
import { Cause, Effect, Exit, Option } from "effect";
import { authorize, type Actor, unattributedReason } from "./actor.ts";

const unattributed: Actor = { kind: "agentUnattributed", harnessServer: "Codex" };

test.each([
  { rpc: "dispatch", command: "StartSession" },
  { rpc: "dispatch", command: "SendTurn" },
  { rpc: "dispatch", command: "Interrupt" },
  { rpc: "dispatch", command: "AddComment" },
  { rpc: "sessions.setVisuals", command: null },
  { rpc: "settings.set", command: null },
  { rpc: "extensions.pair", command: null },
])("a shared server cannot acquire authority through $rpc:$command", async (request) => {
  const result = await Effect.runPromise(
    Effect.exit(authorize(unattributed, ["read", "comment", "start", "turn", "approve"], request))
  );

  expect(Exit.isFailure(result)).toBe(true);

  if (!Exit.isFailure(result)) return;
  const error = Option.getOrThrow(Cause.findErrorOption(result.cause));
  expect(error.reason).toBe(unattributedReason);
  expect(error._tag).toBe("NotGranted");
});

test("initial session Grant permits comments and reads, and the user keeps its existing gate", async () => {
  const actor: Actor = { kind: "agentSession", sessionId: SessionId.make("s1") };
  await Effect.runPromise(
    authorize(actor, ["read", "comment"], { rpc: "dispatch", command: "AddComment" })
  );

  await Effect.runPromise(authorize(unattributed, [], { rpc: "subscribeHost", command: null }));
  await Effect.runPromise(
    authorize({ kind: "user" }, [], { rpc: "extensions.pair", command: null })
  );

  const denied = await Effect.runPromise(
    Effect.exit(authorize(actor, ["read", "comment"], { rpc: "dispatch", command: "StartSession" }))
  );

  expect(Exit.isFailure(denied)).toBe(true);
});
