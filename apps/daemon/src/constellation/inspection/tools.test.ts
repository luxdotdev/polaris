import { expect, test } from "bun:test";
import { AttemptId, type ConstellationCommand, SessionId } from "@polaris/protocol";
import { Effect, Predicate } from "effect";
import { CID } from "../../engine/constellation.testing.ts";
import { McpBinding } from "../../mcp/binding.ts";
import { constellationTools, type ConstellationCommands } from "../../mcp/tools.ts";
import { finding, refusal } from "../decision.ts";
import { graphFree, verdictResult } from "./verdict.ts";
import { claimed } from "../../engine/constellation.testing.ts";
import { constellationInstructions } from "../skills/index.ts";

const INSPECTOR = SessionId.make("inspector");

const binding = McpBinding.cases.Inspector.make({
  sessionId: INSPECTOR,
  constellationId: CID,
  attemptId: AttemptId.make("a1"),
  inspectionId: "c1:9:inspection",
});

const commands = (
  command: ConstellationCommands["command"],
  reads: Array<string> = []
): ConstellationCommands => ({
  command,
  status: () => {
    reads.push("status");

    return Effect.die("an Inspector never reads status");
  },
  resolve: () => Effect.die("an Inspector resolves nothing"),
  logbook: {
    read: () => {
      reads.push("logbook");

      return Effect.die("an Inspector reads the Logbook in its brief, not by tool");
    },
  },
});

test("an Inspector's tools are its verdict alone: nothing reads a transcript, a session or the graph", () => {
  const tools = constellationTools(
    binding,
    commands(() => Effect.die("unused"))
  );

  expect(tools.map((t) => t.name)).toEqual(["verdict"]);
  expect(constellationInstructions(binding)).not.toContain("read_worker");
});

test("verdict commits an Inspect naming its Inspection, bound to the Inspector's session", async () => {
  const sent: Array<{ sessionId: SessionId; command: ConstellationCommand }> = [];

  const [tool] = constellationTools(
    binding,
    commands((caller, _id, command) => {
      sent.push({ sessionId: caller.sessionId, command });

      return Effect.succeed(verdictResult(10, null));
    })
  );

  const result = await tool!.call({ verdict: "send_back", reason: "a.ts drops the retry." });

  expect(result.isError).toBeUndefined();
  expect(sent).toHaveLength(1);
  expect(sent[0]!.sessionId).toBe(INSPECTOR);
  expect(Predicate.isTagged(sent[0]!.command, "Inspect") ? sent[0]!.command : null).toMatchObject({
    attemptId: "a1",
    inspectionId: "c1:9:inspection",
    verdict: "send_back",
    reason: "a.ts drops the retry.",
  });
});

test("a refused verdict answers with its findings and never the graph, without a status read", async () => {
  const reads: Array<string> = [];

  const stale = refusal(claimed(), [
    finding("E-INSPECTION-STALE", "This Inspection is over", "Stop here."),
  ]);

  const [tool] = constellationTools(
    binding,
    commands(() => Effect.fail(graphFree(stale)), reads)
  );

  const result = await tool!.call({ verdict: "approve", reason: "" });

  expect(stale.graph).not.toBeNull();
  expect(result.isError).toBe(true);
  expect(result.structuredContent?.graph).toBeNull();
  expect(result.structuredContent?.findings?.map((f) => f.code)).toEqual(["E-INSPECTION-STALE"]);
  expect(reads).toEqual([]);
});
