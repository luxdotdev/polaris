import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import { fixture } from "../runtime/fixtures.testing.ts";

/** Real broker/scripted provider: historical ownership is data; the challenge runs on a current live feed. */
test("historical recovery selects a current subscribed context and keeps exact scope across repeated challenges", async () => {
  const f = await fixture("ordinary", 10, undefined, undefined, undefined, true);

  try {
    const original = await f.acquire("one", "original");
    await f.open("one", original.context);
    await f.ready("one", original.context);
    const historical = original.context;
    const replacement = await f.broker.restart("one", historical);
    await f.open("one", replacement.context);
    await f.ready("one", replacement.context);
    const signal = new AbortController();

    const iterator = f.broker
      .watch("one", replacement.context, signal.signal)
      [Symbol.asyncIterator]();

    await iterator.next();

    const challenge = P.LanguageResourceReceiptChallenge.cases.Recover.make({
      nonce: "nonce",
      operationId: "operation",
      proposalId: "historical-proposal",
      groupId: "group",
      previewFingerprint: "a".repeat(64),
      hostReceiptRevision: 9,
      intent: "undo",
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      const pending = f.broker.challengeRecoveryReceipt(
        "one",
        historical,
        challenge,
        signal.signal
      );

      let event: P.LanguageContextEvent | undefined;

      for (let i = 0; i < 20; i++) {
        const next = await iterator.next();

        if (next.done) break;

        if (Schema.is(P.LanguageContextEvent.cases.ServerRequest)(next.value)) {
          event = next.value;
          break;
        }
      }

      if (event === undefined || !Schema.is(P.LanguageContextEvent.cases.ServerRequest)(event))
        throw new Error("Recovery challenge missing");
      expect(event.request.context).toEqual(replacement.context);
      expect(event.request.context.generation).toBeGreaterThan(historical.generation);
      await f.broker.respond(
        "one",
        P.LanguageServerResponse.make({
          context: replacement.context,
          response: {
            jsonrpc: "2.0",
            id: event.request.request.id,
            result: {
              nonce: "nonce",
              operationId: "operation",
              groupId: "group",
              localRevision: 2,
              previewFingerprint: "a".repeat(64),
              hostReceiptRevision: 9,
            },
          },
        })
      );
      expect((await pending).hostReceiptRevision).toBe(9);
    }

    const refused = async <A>(pending: Promise<A>) =>
      expect(
        await pending.then(
          () => false,
          () => true
        )
      ).toBe(true);

    await refused(
      f.broker.challengeRecoveryReceipt("foreign", historical, challenge, signal.signal)
    );
    await refused(
      f.broker.challengeRecoveryReceipt(
        "one",
        { ...historical, checkout: f.worktree },
        challenge,
        signal.signal
      )
    );

    const verify = P.LanguageResourceReceiptChallenge.cases.Verify.make({
      nonce: "nonce",
      operationId: "operation",
      proposal: {
        format: 2,
        proposalId: "proposal",
        origin: "rename",
        label: "Fixture",
        edit: {},
        snapshots: [],
        resourceSnapshots: [],
        expiresAt: Date.now() + 10000,
        fence: { context: historical, requiredSequence: 0, documents: [] },
      },
      drafts: {
        format: 2,
        durable: true,
        groupId: "group",
        previewFingerprint: "a".repeat(64),
        resourceSnapshots: [],
        descendants: [],
      },
    });

    await refused(f.broker.challengeRecoveryReceipt("one", historical, verify, signal.signal));
    signal.abort();
    await iterator.return?.();
    await refused(
      f.broker.challengeRecoveryReceipt("one", historical, challenge, new AbortController().signal)
    );
  } finally {
    await f.dispose();
  }
});
