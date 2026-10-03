import { test, expect } from "bun:test";
import { RefactorController } from "./controller.ts";
import { RefactorCoordinator } from "./coordinator.ts";
import { memoryGroups } from "./storage.ts";
import { draftReceipt, previewFingerprint } from "./group.ts";
import { fixture } from "./testing.ts";
import type { RefactorPort } from "./coordinator.ts";

const prepared = async () => {
  const f = fixture();
  const store = memoryGroups();
  const coordinator = new RefactorCoordinator(store, f.port, "utf-16");
  const preview = await coordinator.preview(f.proposal);

  await store.commit(
    {
      format: 2,
      id: "group",
      operationId: "operation",
      hostKey: "host",
      revision: 0,
      updatedAt: Date.now(),
      fingerprint: await previewFingerprint(f.proposal),
      proposal: f.proposal,
      originals: preview.originals,
      documents: preview.originals,
      touched: preview.touched,
      state: "prepared",
      outcome: null,
      message: "",
    },
    null
  );
  const group = (await store.get("group"))!;

  return { f, store, group, receipt: draftReceipt(group) };
};

test("receipt verification refuses independent authority replaced during validation wait", async () => {
  const { f, store, receipt } = await prepared();
  let context = f.proposal.fence.context;

  const port: RefactorPort = {
    ...f.port,
    authority: () => Promise.resolve(context),
    validate: async () => {
      context = { ...context, generation: context.generation + 1 };
    },
  };

  const coordinator = new RefactorCoordinator(store, port, "utf-16");

  await rejected(
    coordinator.verifyReceipt(context, f.proposal, receipt, "operation"),
    "authenticated context"
  );
});

test("receipt verification refuses prepared group replaced during validation wait", async () => {
  const { f, store, group, receipt } = await prepared();

  const coordinator = new RefactorCoordinator(
    store,
    {
      ...f.port,
      validate: async () => {
        await store.commit({ ...group, revision: 1, state: "unknown" }, 0);
      },
    },
    "utf-16"
  );

  await rejected(
    coordinator.verifyReceipt(f.proposal.fence.context, f.proposal, receipt, "operation"),
    "changed while verifying"
  );
  expect((await store.get(group.id))?.state).toBe("unknown");
});

const rejected = async (result: Promise<void>, message: string) => {
  let error = "";

  try {
    await result;
  } catch (cause) {
    error = String(cause);
  }

  expect(error).toContain(message);
};

test("direct user action cannot replace a pending explicit server preview", async () => {
  const f = fixture();
  const coordinator = new RefactorCoordinator(memoryGroups(), f.port, "utf-16");
  const controller = new RefactorController("host", coordinator);

  await controller.offer(f.proposal);
  await rejected(
    controller.applyAction({ ...f.proposal, origin: "code-action" }),
    "current refactor preview"
  );
  expect(controller.state.getState().preview?.proposal.proposalId).toBe(f.proposal.proposalId);
  expect(f.calls).toEqual([]);
});
