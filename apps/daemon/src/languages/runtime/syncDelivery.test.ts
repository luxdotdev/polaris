import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { LanguageDocumentNotification } from "@polaris/protocol";
import { OrderedConnection } from "../transport/index.ts";
import { fixture } from "./fixtures.testing.ts";

for (const operation of ["restart", "configure", "disconnect"] as const) {
  test(`held provider delivery cannot acknowledge a retired context after ${operation}`, async () => {
    const f = await fixture();
    // oxlint-disable-next-line typescript/unbound-method -- Restore the prototype method; call it with each actual connection as receiver.
    const original = OrderedConnection.prototype.send;
    let release = () => {};

    let delivered = () => {};

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const entered = new Promise<void>((resolve) => {
      delivered = resolve;
    });

    try {
      const { context } = await f.acquire();
      await f.open("one", context);
      await f.ready("one", context);
      OrderedConnection.prototype.send = async function (message) {
        await original.call(this, message);

        if ("method" in message && message.method === "textDocument/didChange") {
          delivered();
          await gate;
        }
      };

      const pending = f.broker.sync("one", {
        context,
        sequence: 2,
        notification: LanguageDocumentNotification.cases.Change.make({
          uri: f.uri,
          previousVersion: 1,
          version: 2,
          changes: [{ text: "changed" }],
        }),
      });

      const rejected = assert.rejects(pending, { reason: "stale-generation" });
      await entered;

      switch (operation) {
        case "restart":
          await f.broker.restart("one", context);
          break;
        case "configure":
          await f.broker.configure("one", context, f.settings);
          break;
        case "disconnect":
          f.broker.disconnect("one");
          break;
      }

      release();
      await rejected;
      expect(() => f.broker.snapshot("one", context)).toThrow();
    } finally {
      release();
      OrderedConnection.prototype.send = original;
      await f.dispose();
    }

    expect(f.broker.stats().processes).toBe(0);
    expect(f.broker.stats().processSlots).toBe(0);
  });
}
