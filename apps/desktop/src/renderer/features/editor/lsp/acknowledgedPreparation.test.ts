import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import type { PrepareLanguageEdit } from "./preparation.ts";
import {
  createAcknowledgedPreparation,
  type CurrentPreparationDocument,
} from "./acknowledgedPreparation.ts";

const fixture = () => {
  const context = P.LanguageContextIdentity.make({
    hostId: P.HostId.make("fake"),
    clientId: "client",
    contextId: "context",
    providerId: "provider",
    projectRoot: "/fixture",
    generation: 1,
    configurationFingerprint: "a".repeat(64),
    checkout: P.LanguageCheckout.cases.Workspace.make({
      workspaceId: P.WorkspaceId.make("fixture"),
      path: "/fixture",
    }),
  });

  const uri = "file:///fixture/a%23b.ts";

  const fence = P.LanguageRequestFence.make({
    context,
    requiredSequence: 3,
    documents: [{ uri, version: 7 }],
  });

  const edit = P.LanguageWorkspaceEdit.make({ changes: { [uri]: [] } });

  const request = P.LanguageFeatureRequest.make({
    requestId: "request",
    fence,
    method: "textDocument/rename",
    params: {},
    deadline: Date.now() + 5000,
  });

  const input = {
    request,
    result: P.LanguageFeatureResult.make({ requestId: "request", fence, result: edit }),
    edit,
    origin: "rename" as const,
    label: "Rename",
    signal: new AbortController().signal,
  };

  const proposal = P.LanguageEditProposal.make({
    proposalId: "host-issued",
    fence,
    origin: "rename",
    label: "Rename",
    expiresAt: Date.now() + 5000,
    edit,
    snapshots: [],
  });

  let documents: readonly CurrentPreparationDocument[] = [
    { uri, buffer: { version: 7, draftRevision: 18, text: "unsaved😀\r\n" } },
  ];

  const controller = new AbortController();

  const authority = {
    hostKey: "fake",
    context,
    identity: { hostId: context.hostId, clientId: context.clientId, connectionEpoch: 9 },
    token: {},
    signal: controller.signal,
  };

  const calls: string[] = [];
  let afterAck = () => {};

  let afterPrepare = () => {};

  const transport = {
    acknowledge: async (
      sentFence: P.LanguageRequestFence,
      buffer: { uri: string; version: number; draftRevision: number; text: string }
    ) => {
      expect(sentFence).toEqual(fence);
      expect(buffer).toEqual({ uri, version: 7, draftRevision: 18, text: "unsaved😀\r\n" });
      calls.push("ack");
      afterAck();

      return { context, uri, version: 7, draftRevision: 18, acceptedSequence: 3 };
    },
    prepare: async (captured: Parameters<PrepareLanguageEdit>[0]) => {
      expect(captured).toBe(input);
      calls.push("prepare");
      afterPrepare();

      return proposal;
    },
  };

  const prepare = createAcknowledgedPreparation({
    authority: () => authority,
    transport: () => transport,
    inventory: () => Promise.resolve(documents),
  });

  return {
    input,
    proposal,
    prepare,
    calls,
    change: () => {
      documents = [{ uri, buffer: { version: 7, draftRevision: 19, text: "newer" } }];
    },
    afterAck: (run: () => void) => {
      afterAck = run;
    },
    afterPrepare: (run: () => void) => {
      afterPrepare = run;
    },
    abort: () => controller.abort(),
  };
};

test("exact current inventory tuple is acknowledged before authoritative preparation with distinct draft revision", async () => {
  const f = fixture();
  expect(await f.prepare(f.input)).toBe(f.proposal);
  expect(f.calls).toEqual(["ack", "prepare"]);
});

test("typing after acknowledgment prevents preparation; typing during preparation refuses its late proposal", async () => {
  const first = fixture();
  first.afterAck(first.change);
  await Promise.resolve(expect(first.prepare(first.input)).rejects.toThrow("draft changed"));
  expect(first.calls).toEqual(["ack"]);
  const second = fixture();
  second.afterPrepare(second.change);
  await Promise.resolve(expect(second.prepare(second.input)).rejects.toThrow("draft changed"));
  expect(second.calls).toEqual(["ack", "prepare"]);
});

test("authority abort after acknowledgment cannot issue a preparation request", async () => {
  const f = fixture();
  f.afterAck(f.abort);
  await Promise.resolve(expect(f.prepare(f.input)).rejects.toThrow("context changed"));
  expect(f.calls).toEqual(["ack"]);
});
