import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { RefactorController } from "./controller.ts";
import { RefactorCoordinator } from "./coordinator.ts";
import { memoryGroups } from "./storage.ts";
import { fixture } from "./testing.ts";
import { draftReceipt, type DraftGroup } from "./group.ts";
import { verifyResourceReceiptChallenge, type ResourceReceiptPorts } from "./resourceReceipt.ts";

const staged = async () => {
  const f = fixture();
  const store = memoryGroups();
  const coordinator = new RefactorCoordinator(store, f.port, "utf-16");
  const preview = await coordinator.preview(f.proposal);

  const group: DraftGroup = {
    format: 2,
    id: "private-group",
    operationId: "exact-operation",
    hostKey: "host",
    revision: 0,
    updatedAt: Date.now(),
    fingerprint: preview.fingerprint,
    proposal: f.proposal,
    originals: preview.originals,
    documents: preview.originals,
    touched: preview.touched,
    state: "prepared",
    outcome: null,
    message: "Awaiting Host",
  };

  await store.commit(group, null);
  const controller = new RefactorController("host", coordinator);
  let valid = true;

  const ports: ResourceReceiptPorts = {
    groups: store,
    controller: () => controller,
    current: () => {
      if (!valid) throw new Error("Independent Main identity changed");
    },
  };

  const verify = P.LanguageResourceReceiptChallenge.cases.Verify.make({
    nonce: "host-nonce",
    operationId: group.operationId,
    proposal: f.proposal,
    drafts: draftReceipt(group),
  });

  return {
    f,
    store,
    group,
    controller,
    ports,
    verify,
    invalidate: () => {
      valid = false;
    },
  };
};

test("private challenge refuses Boolean receipt forgery, foreign operation, modified proposal and changed authority", async () => {
  const f = await staged();
  const context = f.f.proposal.fence.context;

  for (const challenge of [
    { ...f.verify, drafts: { ...f.verify.drafts, previewFingerprint: "f".repeat(64) } },
    { ...f.verify, operationId: "foreign-operation" },
    { ...f.verify, proposal: { ...f.verify.proposal, label: "Forged label" } },
  ]) {
    await Promise.resolve(
      expect(verifyResourceReceiptChallenge(f.ports, context, challenge)).rejects.toThrow(
        "receipt does not own"
      )
    );
  }

  expect(await f.store.get(f.group.id)).toEqual(f.group);
  expect(f.f.calls).toEqual([]);
  f.invalidate();
  await Promise.resolve(
    expect(verifyResourceReceiptChallenge(f.ports, context, f.verify)).rejects.toThrow(
      "Main identity changed"
    )
  );
});

test("Resolve exact acceptance returns only its persisted proposal; mismatched ordered snapshots refuse", async () => {
  const f = await staged();
  const proposal = f.f.proposal;

  const acceptance = P.LanguageTreeEditAcceptance.make({
    format: 2,
    proposalId: proposal.proposalId,
    operationId: f.group.operationId,
    fence: proposal.fence,
    snapshots: proposal.snapshots,
    resourceSnapshots: proposal.resourceSnapshots,
    decision: "accept",
  });

  const challenge = P.LanguageResourceReceiptChallenge.cases.Resolve.make({
    nonce: "resolve-nonce",
    operationId: f.group.operationId,
    acceptance,
  });

  const result = await verifyResourceReceiptChallenge(f.ports, proposal.fence.context, challenge);
  expect(result.proposal).toEqual(proposal);
  expect(result.nonce).toBe("resolve-nonce");
  expect(result.localRevision).toBe(0);
  await Promise.resolve(
    expect(
      verifyResourceReceiptChallenge(f.ports, proposal.fence.context, {
        ...challenge,
        acceptance: { ...acceptance, snapshots: [] },
      })
    ).rejects.toThrow("acceptance does not own")
  );
});

test("independent identity replacement during private disk validation refuses without a reply or mutation", async () => {
  const f = await staged();

  const controller = new RefactorController(
    "host",
    new RefactorCoordinator(
      f.store,
      {
        ...f.f.port,
        validate: async () => {
          f.invalidate();
        },
      },
      "utf-16"
    )
  );

  await Promise.resolve(
    expect(
      verifyResourceReceiptChallenge(
        { ...f.ports, controller: () => controller },
        f.f.proposal.fence.context,
        f.verify
      )
    ).rejects.toThrow("Main identity changed")
  );
  expect(await f.store.get(f.group.id)).toEqual(f.group);
  expect(f.f.calls).toEqual([]);
});

test("recovery challenge requires exact durable Host revision and refuses a newer local edit", async () => {
  const f = fixture();
  const store = memoryGroups();
  const coordinator = new RefactorCoordinator(store, f.port, "utf-16");

  const group = await coordinator.accept(
    await coordinator.preview(f.proposal),
    "group",
    "operation",
    "host"
  );

  const controller = new RefactorController("host", coordinator);

  const ports: ResourceReceiptPorts = {
    groups: store,
    controller: () => controller,
    current: () => {},
  };

  const challenge = P.LanguageResourceReceiptChallenge.cases.Recover.make({
    nonce: "recover-nonce",
    operationId: group.operationId,
    groupId: group.id,
    proposalId: group.proposal.proposalId,
    previewFingerprint: group.fingerprint,
    hostReceiptRevision: group.outcome!.receiptRevision,
    intent: "undo",
  });

  expect(
    (await verifyResourceReceiptChallenge(ports, f.proposal.fence.context, challenge)).localRevision
  ).toBe(1);
  await Promise.resolve(
    expect(
      verifyResourceReceiptChallenge(ports, f.proposal.fence.context, {
        ...challenge,
        hostReceiptRevision: challenge.hostReceiptRevision + 1,
      })
    ).rejects.toThrow("reconciled Host receipt")
  );
  await store.commit({ ...group, revision: 2, state: "conflict" }, 1);
  await Promise.resolve(
    expect(
      verifyResourceReceiptChallenge(ports, f.proposal.fence.context, challenge)
    ).rejects.toThrow("reconciled Host receipt")
  );
  expect(f.calls).toEqual(["accept", "publish:applied"]);
});

test("replacement context restores historical group for status and recovery, never old acceptance", async () => {
  const f = fixture();
  const store = memoryGroups();
  const previous = new RefactorCoordinator(store, f.port, "utf-16");

  const group = await previous.accept(
    await previous.preview(f.proposal),
    "group",
    "operation",
    "host"
  );

  const current = { ...f.proposal.fence.context, contextId: "replacement", generation: 2 };

  const coordinator = new RefactorCoordinator(
    store,
    {
      ...f.port,
      authority: () => Promise.resolve(current),
    },
    "utf-16"
  );

  const controller = new RefactorController("host", coordinator);
  await controller.restore();
  expect(controller.state.getState().group?.id).toBe(group.id);
  await coordinator.status(group.id);

  const challenge = P.LanguageResourceReceiptChallenge.cases.Recover.make({
    nonce: "new-connection-nonce",
    operationId: group.operationId,
    groupId: group.id,
    proposalId: group.proposal.proposalId,
    previewFingerprint: group.fingerprint,
    hostReceiptRevision: group.outcome!.receiptRevision,
    intent: "undo",
  });

  const ports: ResourceReceiptPorts = {
    groups: store,
    controller: () => controller,
    current: () => {},
  };

  const verified = await verifyResourceReceiptChallenge(ports, current, challenge);
  expect(verified.groupId).toBe(group.id);
  await Promise.resolve(
    expect(coordinator.preview(f.proposal)).rejects.toThrow("authenticated context")
  );
  await Promise.resolve(
    expect(
      coordinator.verifyReceipt(current, f.proposal, draftReceipt(group), "operation")
    ).rejects.toThrow("authenticated context")
  );
  await controller.recover("undo");
  expect(controller.state.getState().group?.state).toBe("restored");
  expect(f.calls.filter((call) => call === "accept")).toHaveLength(1);

  const foreign = { ...current, checkout: { ...current.checkout, path: "/foreign" } };

  const refused = new RefactorCoordinator(
    store,
    { ...f.port, authority: () => Promise.resolve(foreign) },
    "utf-16"
  );

  await Promise.resolve(
    expect(refused.status(group.id)).rejects.toThrow(
      "another authenticated Host, Client or checkout"
    )
  );
});

test("moving verification requires prior full proof and checks Client drafts without repeating original disk validation", async () => {
  const f = await staged();
  let diskMoved = false;
  let edited = false;
  let movingChecks = 0;

  const coordinator = new RefactorCoordinator(
    f.store,
    {
      ...f.f.port,
      validate: async () => {
        if (diskMoved) throw new Error("Original disk paths moved");
      },
      moving: async () => {
        movingChecks++;

        if (edited) throw new Error("Client draft revision changed");
      },
    },
    "utf-16"
  );

  const controller = new RefactorController("host", coordinator);
  const ports = { ...f.ports, controller: () => controller };
  const moving = { ...f.verify, phase: "moving" as const };
  await Promise.resolve(
    expect(
      verifyResourceReceiptChallenge(ports, f.f.proposal.fence.context, moving)
    ).rejects.toThrow("previously verified")
  );
  await verifyResourceReceiptChallenge(ports, f.f.proposal.fence.context, f.verify);
  diskMoved = true;
  const response = await verifyResourceReceiptChallenge(ports, f.f.proposal.fence.context, moving);
  expect(response.localRevision).toBe(f.group.revision);
  expect(movingChecks).toBe(2);
  expect(await f.store.get(f.group.id)).toEqual(f.group);
  edited = true;
  await Promise.resolve(
    expect(
      verifyResourceReceiptChallenge(ports, f.f.proposal.fence.context, moving)
    ).rejects.toThrow("draft revision changed")
  );
  expect(f.f.calls).toEqual([]);
});
