import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { FeatureEvidence } from "./featureEvidence.ts";

const fixture = (
  method: (typeof P.LanguageFeatureRequest.Type)["method"] = "textDocument/rename"
) => {
  const context = P.LanguageContextIdentity.make({
    hostId: P.HostId.make("fake"),
    clientId: "client",
    contextId: "context",
    checkout: P.LanguageCheckout.cases.Workspace.make({
      workspaceId: P.WorkspaceId.make("ws"),
      path: "/fixture",
    }),
    projectRoot: "/fixture",
    providerId: "provider",
    generation: 1,
    configurationFingerprint: "a".repeat(64),
  });

  const fence = P.LanguageRequestFence.make({
    context,
    requiredSequence: 1,
    documents: [{ uri: "file:///fixture/a.ts", version: 1 }],
  });

  const edit = P.LanguageWorkspaceEdit.make({
    changes: {
      "file:///fixture/a.ts": [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
          newText: "renamed",
        },
      ],
    },
  });

  const request = P.LanguageFeatureRequest.make({
    requestId: "request",
    fence,
    method,
    params: { textDocument: { uri: "file:///fixture/a.ts" } },
    deadline: Date.now() + 5000,
  });

  const result = P.LanguageFeatureResult.make({
    requestId: request.requestId,
    fence,
    result: edit,
  });

  let now = 0;

  const evidence = new FeatureEvidence(() => now);

  return {
    request,
    result,
    edit,
    evidence,
    time: (value: number) => {
      now = value;
    },
  };
};

test("renderer request/result echoes cannot mint Host feature evidence", () => {
  const f = fixture();
  const verify = () => f.evidence.verify("client", f.request, f.result, "rename", f.edit);
  expect(verify).toThrow();
  f.evidence.record("client", f.request, f.result);
  expect(verify).not.toThrow();
  expect(() => f.evidence.verify("foreign", f.request, f.result, "rename", f.edit)).toThrow();
  expect(() =>
    f.evidence.verify("client", f.request, { ...f.result, result: {} }, "rename", f.edit)
  ).toThrow();
  expect(() =>
    f.evidence.verify("client", { ...f.request, params: {} }, f.result, "rename", f.edit)
  ).toThrow();
  expect(() => f.evidence.verify("client", f.request, f.result, "code-action", f.edit)).toThrow();
});

test("only an exact offered code-action edit can become an intent", () => {
  const f = fixture("textDocument/codeAction");

  const result = P.LanguageFeatureResult.make({
    ...f.result,
    result: [{ title: "Fix", edit: f.edit }],
  });

  f.evidence.record("client", f.request, result);
  expect(() => f.evidence.verify("client", f.request, result, "code-action", f.edit)).not.toThrow();
  expect(() =>
    f.evidence.verify("client", f.request, result, "code-action", { changes: {} })
  ).toThrow();
});

test("expiry, disconnect and bounded eviction retire old delivered intent", () => {
  const f = fixture();
  const verify = () => f.evidence.verify("client", f.request, f.result, "rename", f.edit);
  f.evidence.record("client", f.request, f.result);
  f.time(30000);
  expect(verify).toThrow();
  f.evidence.record("client", f.request, f.result);
  f.evidence.forget("client");
  expect(verify).toThrow();
  f.evidence.record("client", f.request, f.result);

  for (let index = 0; index < 64; index++) {
    const request = P.LanguageFeatureRequest.make({ ...f.request, requestId: `other-${index}` });
    f.evidence.record(
      "client",
      request,
      P.LanguageFeatureResult.make({ ...f.result, requestId: request.requestId })
    );
  }

  expect(verify).toThrow();
});
