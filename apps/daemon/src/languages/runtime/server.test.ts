import { expect, test } from "bun:test";
import {
  HostId,
  LanguageCheckout,
  LanguageContextEvent,
  LanguageContextIdentity,
  LanguageDocumentNotification,
  LanguageServerResponse,
  LanguageEditProposal,
  LanguageTreeEditProposal,
  LanguageServerRequestPayload,
  WorkspaceId,
} from "@polaris/protocol";
import { Schema } from "effect";
import { OrderedConnection } from "../transport/index.ts";
import { memoryPort } from "../transport/fixture.testing.ts";
import { ServerBridge, type ServerHooks } from "./server.ts";
import { Documents } from "./documents.ts";
import { negotiate } from "./capabilities.ts";

function fixture(preparation: Partial<Pick<ServerHooks, "prepareEdit" | "treeEdits">> = {}) {
  const port = memoryPort();
  const events: LanguageContextEvent[] = [];

  const context = LanguageContextIdentity.make({
    hostId: HostId.make("host"),
    clientId: "client",
    contextId: "context",
    checkout: LanguageCheckout.cases.Workspace.make({
      workspaceId: WorkspaceId.make("workspace"),
      path: "/private/tmp/project",
    }),
    projectRoot: "/private/tmp/project",
    providerId: "fake",
    configurationFingerprint: "a".repeat(64),
    generation: 1,
  });

  const documents = new Documents(context);
  const uri = "file:///private/tmp/project/file.ts";
  documents.apply(
    1,
    LanguageDocumentNotification.cases.Open.make({
      uri,
      languageId: "typescript",
      version: 2,
      text: "unsaved",
    }),
    "utf-16"
  );

  const connection = new OrderedConnection(
    port.port,
    () => {},
    () => {}
  );

  const bridge = new ServerBridge({
    context,
    documents,
    connection,
    settings: { nested: { value: 7 } },
    current: () => true,
    authorize: () => Promise.resolve(),
    prepareEdit: undefined,
    ...preparation,
    emit: (event) => events.push(event),
    capabilities: () => {},
  });

  bridge.setBase(negotiate({ capabilities: { textDocumentSync: 1 } }));

  return {
    ...port,
    context,
    documents,
    uri,
    connection,
    bridge,
    events,
    close: async () => {
      bridge.close();
      await connection.close();
    },
  };
}

test("prepared server edits cannot weaken the delivered document fence", async () => {
  const f = fixture({
    prepareEdit: async (_edit, proposal) =>
      LanguageEditProposal.make({ ...proposal, fence: { ...proposal.fence, documents: [] } }),
  });

  try {
    f.bridge.receive({
      jsonrpc: "2.0",
      id: 41,
      method: "workspace/applyEdit",
      params: { edit: { changes: {} } },
    });
    await Bun.sleep(5);
    expect(f.events.some(Schema.is(LanguageContextEvent.cases.ServerRequest))).toBe(false);
    expect(f.messages.find((value) => value.id === 41)).toHaveProperty("error.code", -32602);
  } finally {
    await f.close();
  }
});

test("negotiated tree server delivery retains snapshots and fences its delayed response", async () => {
  const uri = "file:///private/tmp/project/new.ts";
  const resourceSnapshots = [{ uri, canonicalPath: "/private/tmp/project/new.ts", tree: null }];

  const f = fixture({
    treeEdits: () => true,
    prepareEdit: async (_edit, proposal) =>
      LanguageTreeEditProposal.make({ ...proposal, format: 2, resourceSnapshots }),
  });

  try {
    f.bridge.receive({
      jsonrpc: "2.0",
      id: 42,
      method: "workspace/applyEdit",
      params: { edit: { documentChanges: [{ kind: "create", uri }] } },
    });
    await Bun.sleep(5);
    const event = f.events.find(Schema.is(LanguageContextEvent.cases.ServerRequest));

    if (
      event === undefined ||
      !Schema.is(LanguageServerRequestPayload.cases.TreeApplyEdit)(event.payload)
    )
      throw new Error("Dedicated tree delivery missing");
    expect(event.payload.proposal.resourceSnapshots).toEqual(resourceSnapshots);
    expect(event.payload.proposal.edit.documentChanges).toEqual([{ kind: "create", uri }]);
    f.documents.apply(
      2,
      LanguageDocumentNotification.cases.Close.make({ uri: f.uri, version: 2 }),
      "utf-16"
    );
    expect(() =>
      f.bridge.respond(
        LanguageServerResponse.make({
          context: f.context,
          response: { jsonrpc: "2.0", id: 42, result: { applied: false } },
        })
      )
    ).toThrow();
  } finally {
    await f.close();
  }
});

test("configuration correspondence, registration/removal, progress and unsupported responses", async () => {
  const f = fixture();

  try {
    f.bridge.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "workspace/configuration",
      params: { items: [{ section: "nested.value" }, { section: "absent" }] },
    });
    f.bridge.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "client/registerCapability",
      params: { registrations: [{ id: "hover", method: "textDocument/hover" }] },
    });
    f.bridge.receive({
      jsonrpc: "2.0",
      id: 3,
      method: "window/workDoneProgress/create",
      params: { token: "progress" },
    });
    f.bridge.receive({ jsonrpc: "2.0", id: 4, method: "custom/unsupported" });
    await Bun.sleep(5);
    expect(f.messages.find((value) => value.id === 1)).toHaveProperty("result", [7, null]);
    expect(f.messages.find((value) => value.id === 4)).toHaveProperty("error.code", -32601);
    f.bridge.receive({
      jsonrpc: "2.0",
      method: "$/progress",
      params: { token: "progress", value: { kind: "begin", title: "Index" } },
    });
    f.bridge.receive({
      jsonrpc: "2.0",
      id: 5,
      method: "client/unregisterCapability",
      params: { unregisterations: [{ id: "hover", method: "textDocument/hover" }] },
    });
    await Bun.sleep(5);
    expect(f.events.some(Schema.is(LanguageContextEvent.cases.Progress))).toBe(true);
    const capabilities = f.events.filter(Schema.is(LanguageContextEvent.cases.CapabilitiesChanged));
    expect(capabilities[1]?.capabilities.methods).toContain("textDocument/hover");
    expect(capabilities[2]?.capabilities.methods).not.toContain("textDocument/hover");
  } finally {
    await f.close();
  }
});

test("stale push diagnostics discarded, unversioned labelled and applyEdit fails closed without preview", async () => {
  const f = fixture();

  try {
    f.bridge.receive({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri: f.uri, version: 1, diagnostics: [] },
    });
    f.bridge.receive({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri: f.uri, diagnostics: [] },
    });
    f.bridge.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "workspace/applyEdit",
      params: { edit: { changes: {} } },
    });
    await Bun.sleep(5);
    const diagnostics = f.events.filter(Schema.is(LanguageContextEvent.cases.Diagnostics));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.diagnostics.freshness).toBe("unversioned");
    expect(f.messages.find((value) => value.id === 1)).toHaveProperty("result.applied", false);
    expect(() =>
      f.bridge.respond(
        LanguageServerResponse.make({
          context: f.context,
          response: { jsonrpc: "2.0", id: 99, result: null },
        })
      )
    ).toThrow();
  } finally {
    await f.close();
  }
});
