import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";
import { LanguageRequestInputs, LanguageRequestOutputs } from "../../../../shared/languages.ts";
import { bindLanguageResourceReceipts } from "./bindings.ts";
import { respondResourceReceiptRequest } from "./resourceReceipts.ts";
import { proposal } from "../refactors/testing.ts";

const event = (deadline = Date.now() + 5000) =>
  P.LanguageContextEvent.cases.ServerRequest.make({
    request: P.LanguageServerRequest.make({
      context: proposal().fence.context,
      request: P.LanguageJsonRpcRequest.make({
        jsonrpc: "2.0",
        id: "host-challenge",
        method: "polaris/resourceReceipt",
      }),
      deadline,
    }),
    payload: P.LanguageServerRequestPayload.cases.ResourceReceipt.make({
      challenge: P.LanguageResourceReceiptChallenge.cases.Recover.make({
        nonce: "nonce",
        operationId: "operation",
        groupId: "group",
        proposalId: "proposal",
        previewFingerprint: "a".repeat(64),
        hostReceiptRevision: 1,
        intent: "undo",
      }),
    }),
  });

const replies = () => {
  const responses: Array<typeof P.LanguageJsonRpcResponse.Type> = [];

  const api: LanguageApi = {
    request: async (method, input) => {
      if (method !== "languages.server.respond") throw new Error("Unexpected request");
      responses.push(
        Schema.decodeUnknownSync(LanguageRequestInputs["languages.server.respond"])(input).response
      );

      return {
        ok: true,
        value: Schema.decodeUnknownSync(LanguageRequestOutputs[method])(undefined),
      };
    },
    subscribe: () => () => {},
  };

  return { api, responses };
};

test("receipt event replies via typed server.respond without waiting for pending acceptance", async () => {
  const f = replies();

  const dispose = bindLanguageResourceReceipts(async (hostKey, context, challenge) => {
    expect(hostKey).toBe("host");
    expect(context).toEqual(proposal().fence.context);

    return P.LanguageResourceReceiptResponse.make({
      nonce: challenge.nonce,
      operationId: challenge.operationId,
      groupId: "group",
      localRevision: 2,
      previewFingerprint: "a".repeat(64),
      hostReceiptRevision: 1,
    });
  });

  try {
    expect(await respondResourceReceiptRequest(f.api, "host", event())).toBe(true);
    expect(f.responses).toHaveLength(1);
    expect(f.responses[0]?.id).toBe("host-challenge");
    expect(f.responses[0]?.result).toEqual({
      nonce: "nonce",
      operationId: "operation",
      groupId: "group",
      localRevision: 2,
      previewFingerprint: "a".repeat(64),
      hostReceiptRevision: 1,
    });
  } finally {
    dispose();
  }
});

test("missing binding, failed private proof, expired deadline and wrong method send JSON-RPC refusal", async () => {
  const f = replies();
  await respondResourceReceiptRequest(f.api, "host", event());
  let calls = 0;

  const dispose = bindLanguageResourceReceipts(async () => {
    calls++;
    throw new Error("Private text must never cross error RPC");
  });

  try {
    await respondResourceReceiptRequest(f.api, "host", event());
    await respondResourceReceiptRequest(f.api, "host", event(Date.now() - 1));
    const value = event();
    await respondResourceReceiptRequest(f.api, "host", {
      ...value,
      request: {
        ...value.request,
        request: { ...value.request.request, method: "workspace/applyEdit" },
      },
    });
    expect(calls).toBe(1);
    expect(f.responses).toHaveLength(4);
    expect(
      f.responses.every(
        (response) => response.error?.code === -32001 && response.result === undefined
      )
    ).toBe(true);
    expect(JSON.stringify(f.responses)).not.toContain("Private text");
  } finally {
    dispose();
  }
});
