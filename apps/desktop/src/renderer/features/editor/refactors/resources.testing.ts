import {
  LanguageTreeEditProposal,
  LanguageTreeManifest,
  LanguageTreeOperationOutcome,
} from "@polaris/protocol";
import { Schema } from "effect";
import { doc, fixture, proposal } from "./testing.ts";
import type { RefactorPort } from "./coordinator.ts";
import type { DraftDocument } from "./group.ts";

/** Fake Host owns all resource receipts; no production RPC or filesystem mutation is implied. */
export const resourceFixture = (
  originals: readonly DraftDocument[] = [
    doc("/checkout/source/a", "source unsaved"),
    doc("/checkout/target/a", "overwritten unsaved"),
    doc("/checkout/victim/a", "deleted unsaved"),
  ]
) => {
  const tree = Schema.decodeUnknownSync(LanguageTreeManifest)({
    format: 1,
    entries: [
      {
        relativePath: "",
        kind: "directory",
        identity: { device: 1, inode: 1, mode: 448 },
        version: null,
      },
      {
        relativePath: "a",
        kind: "file",
        identity: { device: 1, inode: 2, mode: 384 },
        version: originals[0]!.diskVersion,
      },
    ],
  });

  const input = Schema.decodeUnknownSync(LanguageTreeEditProposal)({
    ...proposal(originals[0]),
    label: "Create, overwrite tree and delete tree",
    snapshots: [],
    resourceSnapshots: ["source", "target", "victim", "created"].map((name) => ({
      uri: "file:///checkout/" + name,
      canonicalPath: "/checkout/" + name,
      tree: name === "created" ? null : tree,
    })),
    edit: {
      documentChanges: [
        { kind: "create", uri: "file:///checkout/created" },
        {
          kind: "rename",
          oldUri: "file:///checkout/source",
          newUri: "file:///checkout/target",
          options: { overwrite: true },
        },
        { kind: "delete", uri: "file:///checkout/victim", options: { recursive: true } },
      ],
    },
  });

  const base = fixture();
  const calls: string[] = [];
  let partial = true;
  let response: LanguageTreeOperationOutcome | null = null;

  const port: RefactorPort = {
    ...base.port,
    inventory: () => Promise.resolve(originals),
    decide: (decision) => {
      calls.push(decision.acceptance.decision);
      response = Schema.decodeUnknownSync(LanguageTreeOperationOutcome)({
        format: 2,
        operationId: decision.acceptance.operationId,
        proposalId: input.proposalId,
        owner: {
          hostId: input.fence.context.hostId,
          clientId: input.fence.context.clientId,
          checkout: input.fence.context.checkout,
        },
        state: partial ? "partial" : "applied",
        draftsDurable: true,
        receiptDurable: true,
        receiptRevision: 4,
        draftGroupId: decision.drafts?.groupId,
        failedChange: partial ? 2 : null,
        message: partial
          ? "Delete failed; recover the confirmed prefix"
          : "All resource operations applied",
        steps: input.edit.documentChanges!.map((operation, index) => ({
          index,
          operation,
          state: partial && index === 2 ? "failed" : "applied",
          before: [],
          owned: [],
          message: "Fake resource receipt",
        })),
      });

      return Promise.resolve(response);
    },
    get: () => {
      calls.push("get");

      return Promise.resolve(response);
    },
    recover: (group, intent) => {
      calls.push(intent);
      response = Schema.decodeUnknownSync(LanguageTreeOperationOutcome)({
        ...group.outcome!,
        state: "restored",
        receiptRevision: group.outcome!.receiptRevision + 1,
        message: "Owned resource prefix restored",
        steps: group.outcome!.steps.map((step) => ({
          ...step,
          state: step.state === "applied" ? "restored" : "not-applied",
        })),
      });

      return Promise.resolve(response);
    },
    publish: () => {},
  };

  return {
    originals,
    proposal: input,
    port,
    calls,
    complete: () => {
      partial = false;
    },
  };
};
