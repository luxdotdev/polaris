import { expect, test } from "bun:test";
import { createVerdictOutbox, deliveryLine, type VerdictSteps } from "./outbox.ts";
import { type VerdictInput, VerdictRefused } from "./verdict.ts";

const input: VerdictInput = {
  verdict: "accept",
  constellationId: "c",
  taskId: "B2",
  attemptId: "a1",
  revision: 3,
  head: "3f9c2e1",
  reply: "Ship it",
};

/** A Host that applies each command id once and repeats a refusal for its id, as the Daemon does. */
const host = (approveFails: ReadonlyArray<"lost" | "refused">) => {
  const applied = { approve: new Set<string>(), tell: new Set<string>() };
  const failures = [...approveFails];
  const refused = new Set<string>();

  const steps: VerdictSteps = {
    approve: async (_, commandId) => {
      if (refused.has(commandId)) throw new VerdictRefused([]);
      const failure = failures.shift();

      if (failure === "refused") {
        refused.add(commandId);
        throw new VerdictRefused([]);
      }

      applied.approve.add(commandId);

      if (failure === "lost") throw new Error("The connection dropped");
    },
    tell: async (_, commandId) => {
      applied.tell.add(commandId);
    },
  };

  return { steps, applied };
};

test("an approval whose reply was lost is retried as the same command, then the lead is told once", async () => {
  const outbox = createVerdictOutbox();
  const { steps, applied } = host(["lost"]);

  const lost = await outbox.submit(steps, input);

  expect(deliveryLine(lost)).toBe("Not approved yet: The connection dropped");
  expect((await outbox.submit(steps, input)).state).toBe("delivered");
  expect(applied.approve.size).toBe(1);
  expect(applied.tell.size).toBe(1);
});

test("a refused approval is sent again as a new command with the edited answer", async () => {
  const outbox = createVerdictOutbox();
  const { steps, applied } = host(["refused"]);

  await outbox.submit(steps, input);
  const delivered = await outbox.submit(steps, { ...input, reply: "Ship it after the tokens" });

  expect(delivered).toMatchObject({
    state: "delivered",
    input: { reply: "Ship it after the tokens" },
  });
  expect(applied.approve.size).toBe(1);
});

test("a new claim on the same task is a delivery of its own", async () => {
  const outbox = createVerdictOutbox();
  const { steps, applied } = host([]);

  await outbox.submit(steps, input);
  await outbox.submit(steps, { ...input, revision: 5, head: "9a01b77" });

  expect(applied.tell.size).toBe(2);
});
