import { expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";
import { LanguageRequestOutputs } from "../../../../shared/languages.ts";
import { LanguageRequests } from "./requests.ts";
import { captureEditIntentFence } from "./editFence.ts";
import type { LanguageProvider } from "./types.ts";

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

  const documents = [
    { uri: "file:///fixture/a.ts", version: 7 },
    { uri: "file:///fixture/b.ts", version: 9 },
  ];

  const buffer = {
    uri: documents[0]!.uri,
    version: 7,
    doc: EditorState.create({ doc: "unsaved😀" }).doc,
  };

  let provider: LanguageProvider = {
    hostKey: "fake",
    context,
    ack: P.LanguageSyncAck.make({ context, acceptedSequence: 3, documents }),
    capabilities: P.LanguageProviderCapabilities.make({
      positionEncoding: "utf-16",
      synchronization: "full",
      openClose: true,
      save: false,
      saveIncludeText: false,
      methods: [
        "textDocument/rename",
        "textDocument/codeAction",
        "codeAction/resolve",
        "textDocument/hover",
      ],
      completionResolve: false,
      actionResolve: true,
      executeCommands: [],
      diagnostics: "none",
      workspaceDiagnostics: false,
    }),
  };

  const sent: P.LanguageFeatureRequest[] = [];
  let observe = () => {};

  const api: LanguageApi = {
    request: async (method, input) => {
      const request = Schema.decodeUnknownSync(P.LanguageFeatureRequest)(input);
      sent.push(request);
      observe();

      return {
        ok: true,
        value: Schema.decodeUnknownSync(LanguageRequestOutputs[method])({
          requestId: request.requestId,
          fence: request.fence,
          result: null,
        }),
      };
    },
    subscribe: () => () => {},
  };

  const requests = new LanguageRequests({ api, buffer: () => buffer, providers: () => [provider] });

  return {
    buffer,
    documents,
    sent,
    requests,
    provider: () => provider,
    observe: (run: () => void) => {
      observe = run;
    },
    changedOther: () => {
      provider = {
        ...provider,
        ack: P.LanguageSyncAck.make({
          context,
          acceptedSequence: 4,
          documents: [{ ...documents[0]! }, { ...documents[1]!, version: 10 }],
        }),
      };
    },
  };
};

test("rename/actions/resolve capture both accepted open documents; hover retains its narrow fence", async () => {
  const f = fixture();

  try {
    for (const method of [
      "textDocument/rename",
      "textDocument/codeAction",
      "codeAction/resolve",
    ] as const) {
      const answers = await f.requests.query(method, () => ({}));
      expect(answers).toHaveLength(1);
      expect(f.sent.at(-1)?.fence.documents).toEqual(f.documents);
      expect(f.sent.at(-1)?.fence.requiredSequence).toBe(3);
    }

    await f.requests.query("textDocument/hover", () => ({}));
    expect(f.sent.at(-1)?.fence.documents).toEqual([f.documents[0]!]);
  } finally {
    f.requests.dispose();
  }
});

test("a second open-document version change rejects delivered edit results and retained intent without rewriting its fence", async () => {
  const f = fixture();
  const original = f.provider();
  const captured = captureEditIntentFence(original, f.buffer);

  try {
    f.observe(f.changedOther);
    expect(await f.requests.query("textDocument/rename", () => ({}))).toEqual([]);
    expect(f.requests.intentCurrent(original, f.buffer, captured)).toBe(false);
    expect(captured.documents).toEqual(f.documents);
    expect(f.sent[0]?.fence.documents).toEqual(f.documents);
  } finally {
    f.requests.dispose();
  }
});

test("duplicate, unknown initiating version and foreign provider acknowledgment cannot create an edit intent", () => {
  const f = fixture();
  const provider = f.provider();

  try {
    expect(() =>
      captureEditIntentFence(
        {
          ...provider,
          ack: P.LanguageSyncAck.make({
            ...provider.ack,
            documents: [f.documents[0]!, f.documents[0]!],
          }),
        },
        f.buffer
      )
    ).toThrow("Duplicate");
    expect(() => captureEditIntentFence(provider, { ...f.buffer, version: 8 })).toThrow(
      "not acknowledged"
    );
    expect(() =>
      captureEditIntentFence(
        {
          ...provider,
          ack: P.LanguageSyncAck.make({
            ...provider.ack,
            context: { ...provider.context, providerId: "foreign" },
          }),
        },
        f.buffer
      )
    ).toThrow("context changed");
  } finally {
    f.requests.dispose();
  }
});
