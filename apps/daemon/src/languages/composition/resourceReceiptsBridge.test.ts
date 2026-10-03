import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import { ServerBridge } from "../runtime/server.ts";
import { Documents } from "../runtime/documents.ts";
import { OrderedConnection } from "../transport/index.ts";
import { memoryPort } from "../transport/fixture.testing.ts";
import { fixture } from "../../files/edits/trees/testing.ts";

const setup = async () => {
  const f = await fixture();
  const r = await f.request(f.chain());
  const events: P.LanguageContextEvent[] = [];
  const port = memoryPort();
  const context = r.proposal.fence.context;
  let current = true;

  const connection = new OrderedConnection(
    port.port,
    () => {},
    () => {}
  );

  const bridge = new ServerBridge({
    context,
    documents: new Documents(context),
    connection,
    settings: {},
    emit: (event) => events.push(event),
    current: () => current,
    authorize: async () => {},
    treeEdits: () => true,
    prepareEdit: undefined,
    capabilities: () => {},
  });

  const challenge = P.LanguageResourceReceiptChallenge.cases.Verify.make({
    nonce: "nonce",
    operationId: "operation",
    proposal: r.proposal,
    drafts: r.drafts,
  });

  const next = async () => {
    for (let i = 0; i < 100 && events.length === 0; i++) await Bun.sleep(1);
    const event = events.pop();

    if (event === undefined || !Schema.is(P.LanguageContextEvent.cases.ServerRequest)(event))
      throw new Error("Missing challenge");

    return event;
  };

  const response = (
    id: typeof P.LanguageJsonRpcRequest.Type.id,
    nonce = "nonce",
    operationId = "operation"
  ) =>
    P.LanguageServerResponse.make({
      context,
      response: {
        jsonrpc: "2.0",
        id,
        result: {
          nonce,
          operationId,
          groupId: r.drafts.groupId,
          localRevision: 1,
          previewFingerprint: r.drafts.previewFingerprint,
          hostReceiptRevision: null,
        },
      },
    });

  return {
    ...f,
    bridge,
    connection,
    port,
    challenge,
    next,
    response,
    retire: () => {
      current = false;
    },
    cleanup: async () => {
      bridge.close();
      await connection.close();
      await f.cleanup();
    },
  };
};

test("private receipt response resolves exact challenge without writing to provider", async () => {
  const f = await setup();

  try {
    const pending = f.bridge.challengeReceipt(f.challenge, new AbortController().signal);
    const event = await f.next();
    expect(Schema.is(P.LanguageServerRequestPayload.cases.ResourceReceipt)(event.payload)).toBe(
      true
    );
    await f.bridge.respond(f.response(event.request.request.id));
    expect((await pending).operationId).toBe("operation");
    expect(f.port.messages).toHaveLength(0);
    expect(() => f.bridge.respond(f.response(event.request.request.id))).toThrow();
  } finally {
    await f.cleanup();
  }
});

for (const fault of ["nonce", "operation", "generation"] as const)
  test(`receipt response rejects wrong ${fault}`, async () => {
    const f = await setup();

    try {
      const pending = f.bridge.challengeReceipt(f.challenge, new AbortController().signal);

      const observed = pending.then(
        () => false,
        () => true
      );

      const event = await f.next();

      if (fault === "generation") f.retire();
      expect(() =>
        f.bridge.respond(
          f.response(
            event.request.request.id,
            fault === "nonce" ? "wrong" : "nonce",
            fault === "operation" ? "other" : "operation"
          )
        )
      ).toThrow();
      expect(await observed).toBe(true);
      expect(f.port.messages).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  });

for (const fault of ["cancel", "close", "timeout"] as const)
  test(`receipt challenge cleans pending ownership on ${fault}`, async () => {
    const f = await setup();

    try {
      const abort = new AbortController();

      const pending = f.bridge.challengeReceipt(
        f.challenge,
        abort.signal,
        fault === "timeout" ? 10 : 5000
      );

      const observed = pending.then(
        () => false,
        () => true
      );

      const event = await f.next();

      if (fault === "cancel") abort.abort();

      if (fault === "close") f.bridge.close();
      expect(await observed).toBe(true);
      expect(() => f.bridge.respond(f.response(event.request.request.id))).toThrow();
      expect(f.port.messages).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  });
