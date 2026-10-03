import {
  LanguageTreeEditProposal,
  LanguageTreeOperationOutcome,
  LanguageCheckout,
} from "@polaris/protocol";
import { Schema } from "effect";
import type { DraftDocument } from "./group.ts";
import type { RefactorPort } from "./coordinator.ts";

export const doc = (path = "/checkout/a", text = "a😀b\r\n", dirty = true): DraftDocument => ({
  uri: new URL("file://" + path).href,
  canonicalPath: path,
  sourcePath: path,
  text,
  dirty,
  diskText: "base",
  diskVersion: { mtimeMs: 1, size: 4, hash: "b".repeat(64) },
  version: 3,
  draftRevision: 5,
  buffer: { version: 3, draftRevision: 5, text },
});

export const proposal = (document = doc()) =>
  Schema.decodeUnknownSync(LanguageTreeEditProposal)({
    format: 2,
    proposalId: "proposal",
    origin: "server-apply-edit",
    label: "Rename symbol",
    expiresAt: Date.now() + 60000,
    fence: {
      context: {
        hostId: "00000000-0000-4000-8000-000000000001",
        clientId: "client",
        contextId: "context",
        checkout: LanguageCheckout.cases.Workspace.make({
          workspaceId: Schema.decodeUnknownSync(
            LanguageCheckout.cases.Workspace.fields.workspaceId
          )("00000000-0000-4000-8000-000000000002"),
          path: "/checkout",
        }),
        projectRoot: "/checkout",
        providerId: "provider",
        configurationFingerprint: "a".repeat(64),
        generation: 1,
      },
      requiredSequence: 0,
      documents: [{ uri: document.uri, version: document.version }],
    },
    edit: {
      changes: {
        [document.uri]: [
          {
            range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } },
            newText: "λ",
          },
        ],
      },
    },
    snapshots: [
      {
        uri: document.uri,
        canonicalPath: document.canonicalPath,
        diskText: document.diskText,
        diskVersion: document.diskVersion,
        buffer: document.buffer,
      },
    ],
    resourceSnapshots: [],
  });

export const fixture = () => {
  let inventory = [doc()];
  const calls: string[] = [];
  let revision = 0;
  let response: LanguageTreeOperationOutcome | null = null;
  let connected = true;

  const port: RefactorPort = {
    authority: () => Promise.resolve(proposal().fence.context),
    inventory: () => Promise.resolve(inventory),
    validate: () => Promise.resolve(),
    current: () => Promise.resolve(),
    publish: (group) => {
      calls.push("publish:" + group.state);
    },
    connected: () => connected,
    decide: (decision) => {
      calls.push(decision.acceptance.decision);
      response = Schema.decodeUnknownSync(LanguageTreeOperationOutcome)({
        format: 2,
        operationId: decision.acceptance.operationId,
        proposalId: "proposal",
        owner: {
          hostId: decision.acceptance.fence.context.hostId,
          clientId: "client",
          checkout: decision.acceptance.fence.context.checkout,
        },
        state: decision.acceptance.decision === "reject" ? "rejected" : "applied",
        draftsDurable: true,
        receiptDurable: true,
        receiptRevision: revision++,
        draftGroupId: decision.drafts?.groupId ?? null,
        steps: [],
        failedChange: null,
        message: "Fixture outcome",
      });

      return Promise.resolve(response);
    },
    get: () => {
      calls.push("get");

      return Promise.resolve(response);
    },
    recover: (group) => {
      calls.push("undo");

      return Promise.resolve({
        ...group.outcome!,
        state: "restored",
        receiptRevision: group.outcome!.receiptRevision + 1,
      });
    },
  };

  return {
    port,
    calls,
    proposal: proposal(),
    setInventory: (value: DraftDocument[]) => {
      inventory = value;
    },
    disconnect: () => {
      connected = false;
    },
  };
};
