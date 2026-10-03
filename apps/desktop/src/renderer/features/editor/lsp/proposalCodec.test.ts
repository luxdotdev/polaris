import { Schema } from "effect";
import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { bindLanguagePreparation, prepareLanguageEdit } from "./preparation.ts";
import { decodePreparedProposal } from "./proposalCodec.ts";
import { offerServerEdit } from "./serverEdits.ts";

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

  const version = new P.FileVersion({ mtimeMs: 1, size: 4, hash: "a".repeat(64) });
  const uri = "file:///fixture/a.ts";
  const fence = P.LanguageRequestFence.make({ context, requiredSequence: 1, documents: [] });

  const legacy = P.LanguageEditProposal.make({
    proposalId: "host-issued",
    origin: "rename",
    label: "Rename",
    fence,
    expiresAt: Date.now() + 5000,
    edit: { changes: { [uri]: [] } },
    snapshots: [
      { uri, canonicalPath: "/fixture/a.ts", diskVersion: version, diskText: "disk", buffer: null },
    ],
  });

  const tree = P.LanguageTreeEditProposal.make({
    ...legacy,
    format: 2,
    origin: "server-apply-edit",
    edit: { documentChanges: [{ kind: "delete", uri }] },
    resourceSnapshots: [
      {
        uri,
        canonicalPath: "/fixture/a.ts",
        tree: {
          format: 1,
          entries: [
            {
              relativePath: "",
              kind: "file",
              identity: { device: 1, inode: 2, mode: 0o644 },
              version,
            },
          ],
        },
      },
    ],
  });

  return { context, version, fence, legacy, tree };
};

test("typed preparation callback with decoded FileVersion snapshots preserves the exact proposal fields", async () => {
  const f = fixture();

  const request = P.LanguageFeatureRequest.make({
    requestId: "request",
    fence: f.fence,
    method: "textDocument/rename",
    params: {},
    deadline: Date.now() + 5000,
  });

  const dispose = bindLanguagePreparation(() => Promise.resolve(f.legacy));

  try {
    const result = await prepareLanguageEdit(
      {
        request,
        result: P.LanguageFeatureResult.make({
          requestId: "request",
          fence: f.fence,
          result: null,
        }),
        edit: f.legacy.edit,
        origin: "rename",
        label: "Rename",
        signal: new AbortController().signal,
      },
      () => true
    );

    expect(result).toEqual(f.legacy);
    expect(result?.snapshots[0]?.diskVersion).toBeInstanceOf(P.FileVersion);
  } finally {
    dispose();
  }
});

test("typed server tree event with decoded disk/resource versions reaches only awaited explicit preview", async () => {
  const f = fixture();
  const offered: P.LanguageEditProposal[] = [];

  const response = await offerServerEdit({
    context: f.context,
    proposal: f.tree,
    kind: "tree",
    treeNegotiated: true,
    providers: [
      {
        hostKey: "fake",
        context: f.context,
        ack: P.LanguageSyncAck.make({ context: f.context, acceptedSequence: 1, documents: [] }),
        capabilities: P.LanguageProviderCapabilities.make({
          positionEncoding: "utf-16",
          synchronization: "full",
          openClose: true,
          save: false,
          saveIncludeText: false,
          methods: [],
          completionResolve: false,
          actionResolve: false,
          executeCommands: [],
          diagnostics: "none",
          workspaceDiagnostics: false,
        }),
      },
    ],
    buffers: [],
    current: () => true,
    offer: async (proposal) => {
      offered.push(proposal);
    },
  });

  expect(offered).toEqual([f.tree]);
  expect(response).toEqual({ applied: false, failureReason: "Edits require user acceptance." });
  expect(decodePreparedProposal(f.tree)).toEqual(f.tree);
});

test("domain encoding never strips unsupported tree metadata or promotes legacy resources", () => {
  const f = fixture();
  expect(() => decodePreparedProposal({ ...f.legacy, resourceSnapshots: [] })).toThrow();
  expect(() =>
    P.decodeLanguageResourceProposal({
      ...Schema.encodeSync(P.LanguageEditProposal)(f.legacy),
      format: 3,
      resourceSnapshots: [],
    })
  ).toThrow();
  expect(() => decodePreparedProposal({ ...f.legacy, edit: f.tree.edit })).toThrow("format2");
});
