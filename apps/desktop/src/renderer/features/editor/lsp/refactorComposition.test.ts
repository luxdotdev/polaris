import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { editProposal, actionProposal, completionProposal } from "./bindings.ts";
import { prepareLanguageEdit } from "./preparation.ts";
import { bindEditorRefactors, type EditorRefactorAuthority } from "./refactorComposition.ts";

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

  const fence = P.LanguageRequestFence.make({ context, requiredSequence: 1, documents: [] });
  const edit = P.LanguageWorkspaceEdit.make({ changes: { "file:///fixture/a.ts": [] } });

  const proposal = P.LanguageEditProposal.make({
    proposalId: "host-issued",
    origin: "rename",
    label: "Rename",
    fence,
    expiresAt: Date.now() + 5000,
    edit,
    snapshots: [],
  });

  const abort = new AbortController();

  let authority: EditorRefactorAuthority | null = {
    hostKey: "fake",
    identity: { hostId: context.hostId, clientId: context.clientId, connectionEpoch: 7 },
    context,
    token: {},
    signal: abort.signal,
  };

  const calls: Array<{ kind: string; proposal: P.LanguageTreeEditProposal }> = [];
  let hold: Promise<void> = Promise.resolve();
  let promotions = 0;
  let preparation: Promise<P.LanguageEditProposal> = Promise.resolve(proposal);

  const controller = {
    hostKey: "fake",
    offer: async (value: P.LanguageTreeEditProposal) => {
      calls.push({ kind: "offer", proposal: value });
      await hold;
    },
    applyAction: async (value: P.LanguageTreeEditProposal) => {
      calls.push({ kind: "apply", proposal: value });
      await hold;
    },
  };

  let available = true;

  const ports = {
    authority: () => authority,
    controller: (hostKey: string, root: string) =>
      available && hostKey === "fake" && root === "/fixture" ? controller : null,
    prepare: () => preparation,
    promoteTextProposal: (value: P.LanguageEditProposal) => {
      promotions++;

      return P.LanguageTreeEditProposal.make({ ...value, format: 2, resourceSnapshots: [] });
    },
  };

  return {
    ports,
    proposal,
    context,
    calls,
    abort,
    promotions: () => promotions,
    remove: () => {
      authority = null;
    },
    replace: () => {
      if (authority !== null) authority = { ...authority, token: {} };
    },
    unavailable: () => {
      available = false;
    },
    hold: (next: Promise<void>) => {
      hold = next;
    },
    prepare: (next: Promise<P.LanguageEditProposal>) => {
      preparation = next;
    },
  };
};

test("composition promotes only legacy text and awaits sole R1 user application/server preview", async () => {
  const f = fixture();
  const dispose = bindEditorRefactors(f.ports);
  let release = () => {};

  f.hold(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  let settled = false;

  try {
    const pending = editProposal?.(f.proposal);
    void Promise.resolve(pending).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(f.calls[0]?.kind).toBe("apply");
    release();
    await pending;

    const tree = P.LanguageTreeEditProposal.make({
      ...f.proposal,
      format: 2,
      edit: { documentChanges: [{ kind: "create", uri: "file:///fixture/new.ts" }] },
      resourceSnapshots: [
        { uri: "file:///fixture/new.ts", canonicalPath: "/fixture/new.ts", tree: null },
      ],
      origin: "server-apply-edit",
    });

    await editProposal?.(tree);
    expect(f.calls[1]).toEqual({ kind: "offer", proposal: tree });
    expect(f.promotions()).toBe(1);
    expect(actionProposal).toBeNull();
    expect(completionProposal).toBeNull();
  } finally {
    release();
    dispose();
  }
});

test("missing independent context/controller and aborted context refuse before invoking R1", async () => {
  for (const mutate of ["remove", "unavailable", "abort"] as const) {
    const f = fixture();
    const dispose = bindEditorRefactors(f.ports);

    try {
      if (mutate === "abort") f.abort.abort();
      else f[mutate]();
      await Promise.resolve(
        expect(Promise.resolve().then(() => editProposal?.(f.proposal))).rejects.toThrow(
          "unavailable"
        )
      );
      expect(f.calls).toHaveLength(0);
    } finally {
      dispose();
    }
  }
});

test("authoritative preparation rejects late replacement and missing preparer without making authority fields", async () => {
  const f = fixture();
  let resolve = (_value: P.LanguageEditProposal) => {};

  f.prepare(
    new Promise((done) => {
      resolve = done;
    })
  );
  let dispose = bindEditorRefactors(f.ports);

  const request = P.LanguageFeatureRequest.make({
    requestId: "request",
    fence: f.proposal.fence,
    method: "textDocument/rename",
    params: {},
    deadline: Date.now() + 5000,
  });

  const input = {
    request,
    result: P.LanguageFeatureResult.make({
      requestId: "request",
      fence: request.fence,
      result: null,
    }),
    edit: f.proposal.edit,
    origin: "rename" as const,
    label: "Rename",
    signal: new AbortController().signal,
  };

  try {
    const pending = prepareLanguageEdit(input, () => true);
    f.replace();
    resolve(f.proposal);
    await Promise.resolve(expect(pending).rejects.toThrow("changed"));
    dispose();
    dispose = bindEditorRefactors({ ...f.ports, prepare: null });
    await Promise.resolve(
      expect(prepareLanguageEdit(input, () => true)).rejects.toThrow("unavailable")
    );
    expect(f.calls).toHaveLength(0);
  } finally {
    dispose();
  }
});

test("old composition disposal cannot remove replacement proposal/preparation registrations", async () => {
  const old = fixture();
  const next = fixture();
  const disposeOld = bindEditorRefactors(old.ports);
  const disposeNext = bindEditorRefactors(next.ports);

  try {
    disposeOld();
    await editProposal?.(next.proposal);
    expect(old.calls).toHaveLength(0);
    expect(next.calls).toHaveLength(1);
  } finally {
    disposeOld();
    disposeNext();
  }
});
