import { createPolaris } from "@polaris/sdk";
import { launchDaemon, type TestDaemon } from "@polaris/sdk/testing";
import {
  CommandId,
  ConstellationId,
  ConstellationStreamItem,
  NotificationItem,
  PlanOperation,
  SessionId,
  TaskDefinition,
  TaskId,
  WorkspaceId,
} from "@polaris/protocol";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { Effect, Option, Stream } from "effect";
import {
  createVerdictOutbox,
  deliveryLine,
  hostSteps,
  type VerdictSteps,
} from "../src/constellation/outbox.ts";
import { messageLead, type VerdictInput } from "../src/constellation/verdict.ts";
import { devBridgeTransport } from "../src/runtime/devBridge.ts";
import { type HostConnection, openHostConnection } from "../src/runtime/hostConnection.ts";
import { type DevBridgeServer, startDevBridge } from "./devBridge.ts";

let daemon: TestDaemon;

let bridge: DevBridgeServer;

let connection: HostConnection;

const id = ConstellationId.make("mobile-verdicts");

beforeAll(async () => {
  daemon = await launchDaemon();
  bridge = startDevBridge(daemon.socketPath);
  const workspaceId = await daemon.registerWorkspace();

  const starter = await createPolaris({
    pairings: [await daemon.pair("setup", ["read", "approve", "start"], "gateway")],
    clientName: "setup",
  });

  const lead = await starter.startSession(daemon.hostId, {
    workspaceId,
    harness: "claude",
    prompt: "Lead the overhaul",
  });

  await starter.close();
  connection = openHostConnection({
    hostId: daemon.hostId,
    name: "Dev Daemon",
    transport: devBridgeTransport({
      hostId: daemon.hostId,
      port: bridge.port,
      token: bridge.token,
    }),
  });

  while (connection.live() === null) await Bun.sleep(50);

  await connection.run((client) =>
    client["constellation.plan"]({
      commandId: CommandId.make("plan-1"),
      constellationId: id,
      start: {
        name: "Orchestrator overhaul",
        workspaceId: WorkspaceId.make(workspaceId),
        leadSessionId: SessionId.make(lead),
      },
      operations: [
        PlanOperation.cases.Add.make({
          task: new TaskDefinition({
            id: TaskId.make("B2"),
            title: "Workspace chips",
            kind: "task",
            brief: "Chips for workspaces",
          }),
        }),
      ],
    })
  );
}, 60_000);

afterAll(async () => {
  await connection.close();
  bridge.stop();
  await daemon.stop();
});

/** What the lead will be told: the operator messages queued for it. */
const toLead = () =>
  connection.run((client) =>
    client["constellation.subscribe"]({ constellationId: id, afterSequence: null }).pipe(
      Stream.runHead,
      Effect.map(Option.getOrThrow),
      Effect.map((item) =>
        ConstellationStreamItem.guards.Snapshot(item)
          ? item.constellation.pendingNotifications.flatMap(({ item: queued }) =>
              NotificationItem.guards.OperatorMessage(queued) ? [queued.text] : []
            )
          : []
      )
    )
  );

let claims = 0;

/** A claim of its own per test, so the lead's queue shows only that test's messages. */
const verdict = (input: Pick<VerdictInput, "verdict" | "reply">): VerdictInput => {
  claims += 1;

  return {
    ...input,
    constellationId: id,
    taskId: "B2",
    attemptId: `attempt-${claims}`,
    revision: 0,
    head: `3f9c2e${claims}`,
  };
};

const count = (all: ReadonlyArray<string>, text: string) => all.filter((t) => t === text).length;

test("send back reaches the lead as the user's verdict with their answer", async () => {
  const input = verdict({ verdict: "send-back", reply: "Wrap to two lines past four workspaces" });

  const delivery = await createVerdictOutbox().submit(hostSteps(connection), input);

  expect(delivery.state).toBe("delivered");
  expect(await toLead()).toContain(
    `Send back B2 (claim ${input.head}): Wrap to two lines past four workspaces`
  );
}, 30_000);

test("an accept the Host refuses tells the lead nothing and can be cancelled", async () => {
  const before = await toLead();
  const outbox = createVerdictOutbox();

  const delivery = await outbox.submit(
    hostSteps(connection),
    verdict({ verdict: "accept", reply: "Wrap" })
  );

  expect(delivery).toMatchObject({ state: "failed", approved: false });
  expect(deliveryLine(delivery)).toStartWith("Not approved: ");
  expect(await toLead()).toEqual(before);
  outbox.cancel(delivery.key);
  expect(outbox.find(id, "B2", null)).toBeNull();
}, 30_000);

test("a double-tapped send back, and one tapped again after it landed, reach the lead once", async () => {
  const outbox = createVerdictOutbox();
  const input = verdict({ verdict: "send-back", reply: "Keep the chips on one line" });
  const steps = hostSteps(connection);

  await Promise.all([outbox.submit(steps, input), outbox.submit(steps, input)]);
  await outbox.submit(steps, input);

  expect(
    count(await toLead(), `Send back B2 (claim ${input.head}): Keep the chips on one line`)
  ).toBe(1);
}, 30_000);

// No handed-up claim can be seeded without a worker's binding, so Approve succeeds at the
// boundary here; the lead's message goes to the real Daemon.
const lossy = (where: "before" | "after"): VerdictSteps => {
  const real = hostSteps(connection);
  let failed = false;

  return {
    approve: () => Promise.resolve(),
    tell: async (input, commandId) => {
      if (where === "after") await real.tell(input, commandId);

      if (!failed) {
        failed = true;
        throw new Error("The connection dropped");
      }

      if (where === "before") await real.tell(input, commandId);
    },
  };
};

test.each(["before", "after"] as const)(
  "an accept whose answer is lost %s reaching the Host stays visible, then reaches the lead once",
  async (where) => {
    const outbox = createVerdictOutbox();
    const input = verdict({ verdict: "accept", reply: `Ship it (${where})` });
    const steps = lossy(where);

    const lost = await outbox.submit(steps, input);

    expect(lost).toMatchObject({ state: "failed", approved: true });
    expect(deliveryLine(lost)).toBe(
      "Approved, but the lead hasn't got your answer yet: The connection dropped"
    );
    // The claim has left the user once it's approved; the answer is still there to retry.
    expect(outbox.find(id, "B2", null)?.input.reply).toBe(`Ship it (${where})`);

    outbox.retryLost(steps, id);

    while (outbox.find(id, "B2", null) !== null) await Bun.sleep(20);

    const text = `Accept B2 (claim ${input.head}). I approved it on my phone; merge it and accept it. My answer: Ship it (${where})`;

    expect(count(await toLead(), text)).toBe(1);
  },
  30_000
);

test("the composer's message reaches the lead", async () => {
  await connection.run((client) => messageLead(client, id, "Hold B2 until the tokens land"));

  expect(await toLead()).toContain("Hold B2 until the tokens land");
}, 30_000);
