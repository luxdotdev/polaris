import { expect, test } from "bun:test";
import {
  ConstellationFinding,
  ConstellationRejected,
  ConstellationCommand,
  ReviewAction,
} from "@polaris/protocol";
import { Effect } from "effect";
import { constellationTools } from "./tools.ts";
import { fakeCommands, leadBinding, workerBinding } from "./testing.ts";

const invoke = (
  tools: ReturnType<typeof constellationTools>,
  name: string,
  input: Parameters<(typeof tools)[number]["call"]>[0]
) => {
  const tool = tools.find((entry) => entry.name === name);

  if (!tool) throw new Error(`No ${name} tool`);

  return tool.call(input);
};

test("worker tools cannot forge role, Constellation, Attempt or operator authority", async () => {
  const fake = fakeCommands();
  const tools = constellationTools(workerBinding, fake.commands);
  expect(tools.map((tool) => tool.name)).toEqual([
    "progress",
    "ask",
    "claim",
    "propose",
    "message",
    "status",
  ]);

  for (const fields of [
    { role: "lead" },
    { attemptId: "other" },
    { constellationId: "other" },
    { authority: "may_decide_and_continue" },
  ]) {
    const result = await invoke(tools, "progress", { note: "forged", ...fields });
    expect(result.isError).toBe(true);
  }

  expect(fake.calls).toHaveLength(0);
  const result = await invoke(tools, "progress", { note: "Checks passed", completed: 1, total: 2 });
  expect(result.content[0]?.text).toEndWith("Next: Review the Claim.");
  expect(fake.calls[0]?.binding).toEqual({ kind: "session", sessionId: workerBinding.sessionId });
  expect(fake.calls[0]?.command).toMatchObject({
    constellationId: workerBinding.constellationId,
    attemptId: workerBinding.attemptId,
  });
});

test("Lead dispatch resolves Host, model and worker names; review requires revision", async () => {
  const fake = fakeCommands();
  const tools = constellationTools(leadBinding, fake.commands);
  await invoke(tools, "dispatch", {
    tasks: [
      { taskId: "A1", worker: { host: "devbox", selection: { harness: "codex", model: "Sol" } } },
      { taskId: "A2", worker: { session: "helper" } },
    ],
  });
  expect(fake.references).toEqual(["model:Sol", "host:devbox", "session:helper"]);
  expect(fake.calls[0]?.command).toMatchObject({
    tasks: [
      { taskId: "A1", worker: { hostId: "host-devbox", selection: { model: "model-Sol" } } },
      { taskId: "A2", worker: { sessionId: "session-helper" } },
    ],
  });
  expect(
    (
      await invoke(tools, "review", {
        task: "A1",
        action: ReviewAction.cases.Stop.make({ reason: "Stop" }),
      })
    ).isError
  ).toBe(true);
  await invoke(tools, "review", {
    task: "A1",
    revision: 7,
    action: ReviewAction.cases.Stop.make({ reason: "Stop" }),
  });
  expect(fake.calls[1]?.command).toMatchObject({ attemptId: "attempt-A1", revision: 7 });
});

test("domain rejections retain every finding and current revision", async () => {
  const fake = fakeCommands();

  const findings = [
    new ConstellationFinding({
      code: "E-DEP-CYCLE",
      message: "Cycle",
      fix: "Remove a dependency.",
    }),
    new ConstellationFinding({ code: "E-REVISION", message: "Old revision", fix: "Read status." }),
  ];

  const commands = {
    ...fake.commands,
    command: () => Effect.fail(new ConstellationRejected({ findings, revision: 12, graph: null })),
  };

  const result = await invoke(constellationTools(workerBinding, commands), "progress", {
    note: "Ready",
  });

  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain("E-DEP-CYCLE");
  expect(result.content[0]?.text).toContain("E-REVISION");
  expect(result.content[0]?.text).toContain('"revision":12');
});

test("tool JSON schemas include referenced Claim definitions", () => {
  const tool = constellationTools(workerBinding, fakeCommands().commands).find(
    (entry) => entry.name === "claim"
  );

  expect(tool?.inputSchema).toHaveProperty("$defs.ConstellationClaimEncoded");
  expect(ConstellationCommand.cases.WorkerClaim.fields.claim).toBeDefined();
});

test("status emits JSON only when asked and every result ends in Next", async () => {
  const tools = constellationTools(workerBinding, fakeCommands().commands);
  const plain = await invoke(tools, "status", {});
  const json = await invoke(tools, "status", { json: true });
  expect(plain.content[0]?.text).not.toContain('"constellation"');
  expect(json.content[0]?.text).toContain('"constellation"');
  expect(json.content[0]?.text).toEndWith("Next: Review the Claim.");
});
