import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import { LanguageRequestInputs, LanguageRequestOutputs } from "../../../../shared/languages.ts";
import type { LanguageApi } from "../../../../shared/api.ts";
import { editProposal, resourceReceiptHandler } from "../lsp/bindings.ts";
import { bindRuntimeRefactors, type RuntimeRefactorContext } from "./runtime.ts";
import { memoryGroups } from "./storage.ts";
import { doc, fixture, proposal } from "./testing.ts";
import { refactorFor } from "./controller.ts";
import type { DraftGroup } from "./group.ts";

const runtimeFixture = () => {
  const f = fixture();
  const abort = new AbortController();
  const input = proposal();

  const provider = {
    hostKey: "host",
    context: input.fence.context,
    ack: P.LanguageSyncAck.make({
      context: input.fence.context,
      acceptedSequence: 1,
      documents: input.fence.documents,
    }),
    capabilities: P.LanguageProviderCapabilities.make({
      positionEncoding: "utf-16",
      synchronization: "full",
      openClose: true,
      save: true,
      saveIncludeText: false,
      methods: ["textDocument/rename"],
      completionResolve: false,
      actionResolve: false,
      executeCommands: [],
      diagnostics: "push",
      workspaceDiagnostics: false,
    }),
  };

  const authority: RuntimeRefactorContext = {
    hostKey: "host",
    context: input.fence.context,
    identity: {
      hostId: input.fence.context.hostId,
      clientId: input.fence.context.clientId,
      connectionEpoch: 1,
    },
    token: {},
    signal: abort.signal,
    provider,
    capabilities: [
      "languages",
      "languages.edits",
      "languages.resources",
      "languages.resources.tree-v2",
    ],
  };

  let contexts = [authority];
  let changed = () => {};

  let acceptCalls = 0;
  let challenges = 0;
  let inventory = [doc()];
  let currentCheck = () => Promise.resolve();
  const groups = memoryGroups();
  const publications: DraftGroup[] = [];

  const api: LanguageApi = {
    request: async (method, value) => {
      if (method === "languages.tree.edit.decide") {
        const decision = Schema.decodeUnknownSync(
          LanguageRequestInputs["languages.tree.edit.decide"]
        )(value);

        if (decision.acceptance.decision === "accept") {
          acceptCalls++;
          const handler = resourceReceiptHandler;

          if (handler === null) throw new Error("Receipt handler is unbound");
          const nonce = "independent-host-nonce";

          const resolved = await handler(
            "host",
            input.fence.context,
            P.LanguageResourceReceiptChallenge.cases.Resolve.make({
              nonce,
              operationId: decision.acceptance.operationId,
              acceptance: decision.acceptance,
            })
          );

          expect(resolved.proposal).toEqual(input);

          const verified = await handler(
            "host",
            input.fence.context,
            P.LanguageResourceReceiptChallenge.cases.Verify.make({
              nonce,
              operationId: decision.acceptance.operationId,
              proposal: input,
              drafts: decision.drafts!,
            })
          );

          expect(verified.groupId).toBe(decision.drafts!.groupId);
          expect(verified.proposal).toBeUndefined();
          challenges += 2;
        }

        const outcome = await f.port.decide(decision);

        return {
          ok: true,
          value: Schema.decodeUnknownSync(LanguageRequestOutputs[method])(outcome),
        };
      }

      if (method === "languages.tree.operation.get") {
        const state = refactorFor("host", "/checkout")?.state.getState().group;

        return {
          ok: true,
          value: Schema.decodeUnknownSync(LanguageRequestOutputs[method])(state?.outcome),
        };
      }

      if (method === "languages.tree.operation.recover") {
        const request = Schema.decodeUnknownSync(
          LanguageRequestInputs["languages.tree.operation.recover"]
        )(value);

        const group = refactorFor("host", "/checkout")?.state.getState().group;

        if (group?.outcome == null) throw new Error("Missing operation receipt");
        expect(request.expectedReceiptRevision).toBe(group.outcome.receiptRevision);

        const verified = await resourceReceiptHandler?.(
          "host",
          input.fence.context,
          P.LanguageResourceReceiptChallenge.cases.Recover.make({
            nonce: "undo-nonce",
            operationId: group.operationId,
            groupId: group.id,
            proposalId: group.proposal.proposalId,
            previewFingerprint: group.fingerprint,
            hostReceiptRevision: group.outcome.receiptRevision,
            intent: "undo",
          })
        );

        expect(verified?.hostReceiptRevision).toBe(group.outcome.receiptRevision);
        const outcome = await f.port.recover(group, "undo");

        return {
          ok: true,
          value: Schema.decodeUnknownSync(LanguageRequestOutputs[method])(outcome),
        };
      }

      throw new Error("Unexpected typed request: " + method);
    },
    subscribe: () => () => {},
  };

  const dispose = bindRuntimeRefactors({
    api: () => api,
    contexts: () => contexts,
    groups,
    opened: () => inventory,
    inventory: () => Promise.resolve(inventory),
    validateDisk: () => Promise.resolve(),
    moving: () => Promise.resolve(),
    current: () => currentCheck(),
    publish: (group) => publications.push(group),
    subscribe: (listener) => {
      changed = listener;

      return () => {};
    },
  });

  return {
    input,
    groups,
    dispose,
    publications,
    authority,
    abort,
    acceptCalls: () => acceptCalls,
    challenges: () => challenges,
    replace: () => {
      contexts = [{ ...authority, token: {} }];
      changed();
    },
    edit: () => {
      inventory = [
        {
          ...doc(),
          text: "newer",
          version: 4,
          buffer: { version: 4, draftRevision: 5, text: "newer" },
        },
      ];
    },
    guard: (next: () => Promise<void>) => {
      currentCheck = next;
    },
    controller: () => refactorFor("host", "/checkout")!,
  };
};

test("runtime uses sole persisted coordinator for Host receipt challenges during acceptance, status and guarded undo", async () => {
  const f = runtimeFixture();

  try {
    await editProposal?.(f.input);
    const controller = f.controller();
    expect(controller.state.getState().preview?.proposal).toEqual(f.input);
    expect(f.acceptCalls()).toBe(0);
    await controller.accept();
    expect(controller.state.getState().error).toBeNull();
    expect(controller.state.getState().group?.state).toBe("applied");
    expect(f.challenges()).toBe(2);
    const persisted = await f.groups.get(controller.state.getState().group!.id);
    expect(persisted?.originals).toEqual([doc()]);
    await controller.status();
    await controller.recover("undo");
    expect(controller.state.getState().group?.state).toBe("restored");
    expect(f.publications.map((group) => group.state)).toEqual(["applied", "restored"]);
  } finally {
    f.dispose();
  }
});

test("typing before acceptance refuses stale preview and performs no Host mutation", async () => {
  const f = runtimeFixture();

  try {
    await editProposal?.(f.input);
    f.edit();
    await f.controller().accept();
    expect(f.controller().state.getState().error).toContain("proposal is stale");
    expect(f.acceptCalls()).toBe(0);
    expect(await f.groups.list()).toEqual([]);
  } finally {
    f.dispose();
  }
});

test("replaced authority invalidates retained controller and refuses old preview", async () => {
  const f = runtimeFixture();

  try {
    await editProposal?.(f.input);
    const previous = f.controller();
    f.replace();
    await previous.accept();
    expect(previous.state.getState().error).toContain("Connect to the Host");
    expect(f.acceptCalls()).toBe(0);
    expect(f.controller()).not.toBe(previous);
  } finally {
    f.dispose();
  }
});
